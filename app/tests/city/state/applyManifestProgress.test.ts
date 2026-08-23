// applyManifestProgress.test.ts — the build's own readout (#185). "Building
// city" used to sit silent for the whole apply; it now names each stage, and
// the count beside it has to come from the stages this apply actually runs.

import { stubPlacementClient, makeBuildingMaterial } from '../../_helpers/cityFixtures';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { effect } from '@preact/signals';
import { RebuildStatus } from '@/state/stores/progress';
import { createCitySceneState } from '@/city/state';
import { buildStageTail } from '@/constants/progress';
import { NodeKind } from '@/types';
import type { CityLayout, DateRanges, Manifest } from '@/types';
import { makeSession } from '../../_helpers/city';

// One city for this file, the way the app makes one for itself.
const session = makeSession();

const EMPTY_DATE_RANGES: DateRanges = {
  minCreated: null,
  maxCreated: null,
  minModified: null,
  maxModified: null,
} as unknown as DateRanges;

function manifest(sig: string): Manifest {
  return {
    tree: { name: 'r', type: NodeKind.Directory, path: '.', children: [] },
    structure_signature: sig,
    layout_signature: sig,
    dateRanges: EMPTY_DATE_RANGES,
    commits: [],
    busyness: { avg: 1, busy: 1 },
  } as unknown as Manifest;
}

// Distinct layout per compute() unless reuseLayoutFrom is supplied (see
// applyManifestReuse.test.ts), plus the worker's mid-pack percent.
function fakeLayoutClient(percents: number[] = []) {
  return {
    compute: vi.fn(
      async (
        _m: Manifest,
        reuseFrom?: CityLayout | null,
        onProgress?: (percent: number) => void
      ) => {
        for (const p of percents) onProgress?.(p);
        return (
          reuseFrom ??
          ({
            buildings: [],
            streets: [],
            lineStats: { min: 0, max: 0 },
            byteStats: { min: 0, max: 0 },
            bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0, cx: 0, cy: 0, width: 0, depth: 0 },
          } as unknown as CityLayout)
        );
      }
    ),
    dispose: vi.fn(),
  };
}

/** Every tail the readout showed, in order, for the apply run inside. */
async function tailsDuring(run: () => Promise<void>): Promise<string[]> {
  session.progress.buildProgress.value = null; // markRebuilding opens every real build this way
  const seen: string[] = [];
  const stop = effect(() => {
    const tail = buildStageTail(session.progress.buildProgress.value);
    if (tail && tail !== seen[seen.length - 1]) seen.push(tail);
  });
  await run();
  stop();
  return seen;
}

describe('sceneState.applyManifest — the build says where it is (#185)', () => {
  beforeEach(() => {
    session.progress.buildProgress.value = null;
  });

  it('opens the rebuild itself, so no caller has to say so first', async () => {
    const state = createCitySceneState(
      fakeLayoutClient() as never,
      stubPlacementClient() as never,
      session.progress,
      makeBuildingMaterial()
    );
    session.progress.rebuildStatus.value = RebuildStatus.Idle;
    const apply = state.applyManifest(manifest('sig-1'));
    // Synchronously: the status is up before the first await yields, or the
    // readout says idle through the stage it is already running.
    expect(session.progress.rebuildStatus.value).toBe(RebuildStatus.Rebuilding);
    await apply;
  });

  it('walks the stages it is going to run', async () => {
    const state = createCitySceneState(
      fakeLayoutClient() as never,
      stubPlacementClient() as never,
      session.progress,
      makeBuildingMaterial()
    );
    const tails = await tailsDuring(() => state.applyManifest(manifest('sig-1')));

    // Every stage of the plan, decoration included: the build places the trees
    // itself, so the walk no longer stops one short.
    expect(tails).toEqual(['0% icons', '25% layout', '50% buildings', '75% trees']);
  });

  it('counts against a shorter plan when the apply has less to do', async () => {
    const state = createCitySceneState(
      fakeLayoutClient() as never,
      stubPlacementClient() as never,
      session.progress,
      makeBuildingMaterial()
    );
    await state.applyManifest(manifest('sig-1'));
    // Same structure signature: the atlas is already right for this tree, so
    // that stage never runs and must not be promised.
    const tails = await tailsDuring(() => state.applyManifest(manifest('sig-1')));

    expect(tails).toEqual(['0% layout', '33% buildings', '67% trees']);
  });

  it('carries the packer percent while it packs', async () => {
    const state = createCitySceneState(
      fakeLayoutClient([7, 61]) as never,
      stubPlacementClient() as never,
      session.progress,
      makeBuildingMaterial()
    );
    const tails = await tailsDuring(() => state.applyManifest(manifest('sig-1')));

    expect(tails).toContain('27% layout');
    expect(tails).toContain('40% layout');
    // The percent belongs to the stage that measured it: entering the next one
    // resets it, so 61% never shows up beside buildings.
    expect(tails.filter((t) => t.endsWith('buildings'))).toEqual(['50% buildings']);
  });

  it('ignores a superseded apply still posting its percent', async () => {
    // The loser's worker keeps reporting until it is told to stop; the readout
    // belongs to whoever is actually going to land.
    let loserProgress: ((percent: number) => void) | undefined;
    const client = {
      compute: vi.fn(
        (_m: Manifest, _reuse?: CityLayout | null, onProgress?: (p: number) => void) => {
          loserProgress ??= onProgress;
          return new Promise<CityLayout>(() => {}); // never resolves
        }
      ),
      dispose: vi.fn(),
    };
    const state = createCitySceneState(
      client as never,
      stubPlacementClient() as never,
      session.progress,
      makeBuildingMaterial()
    );

    void state.applyManifest(manifest('sig-1'));
    void state.applyManifest(manifest('sig-2')); // supersedes the first
    loserProgress?.(80);

    expect(session.progress.buildProgress.value?.percent).toBeNull();
  });
});
