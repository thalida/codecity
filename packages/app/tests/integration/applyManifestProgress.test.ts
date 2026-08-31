// applyManifestProgress.test.ts — the build's own readout (#185). "Building
// city" used to sit silent for the whole apply; it now names each stage, and
// the count beside it has to come from the stages this apply actually runs.

import { DateRanges, Manifest, NodeKind, CityLayout } from '@codecity/city';

// The imports below reach past the package's public surface on purpose, and
// say so by path: they are its internal wiring, which no consumer needs and
// which these tests assemble by hand. A test may reach in; nothing in src/ may.
import type { LayoutConfig } from '../../../city/src/layout/config';
import { createCityState } from '../../../city/src/state';
import { stubPlacementClient, statusFrom } from '@codecity/city/testing';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { effect } from '@preact/signals';

import { buildStageTail } from '@/features/city/state/loading';
import { EMPTY_CITY_STATUS } from '@codecity/city';
import { createTestCityResources } from '@codecity/city/testing';
import { settingsStore } from '@codecity/city/testing';
import { createEmitter } from '@codecity/city/testing';

const SETTINGS = settingsStore();

// One emitter per test file's cities, wired to the overlay's stores exactly as
// City.tsx wires them; re-attached per case so nothing leaks between them.
const events = createEmitter();

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
        _cfg: LayoutConfig,
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

/** Every distinct percent the readout showed, in order, for the apply run
 *  inside. The city folds its own stages into one fraction over the whole
 *  build; the app only renders it, so this covers the seam between what the
 *  city reports and what a readout makes of it. */
let tracked: ReturnType<typeof statusFrom>;

async function tailsDuring(run: () => Promise<void>): Promise<string[]> {
  // Straight off the status the city reports: there is no copy of it to keep
  // clean between cases.
  const seen: string[] = [];
  const stop = tracked.onStatus((status) => {
    const tail = buildStageTail(status);
    if (tail && tail !== seen[seen.length - 1]) seen.push(tail);
  });
  await run();
  stop();
  return seen;
}

describe('cityState.applyManifest — the build says where it is (#185)', () => {
  beforeEach(() => {
    // A fresh fold per case: the emitter is module-level, and a previous case's
    // tracker still listening would keep folding into it.
    tracked = statusFrom(events);
  });

  afterEach(() => {
    tracked.dispose();
  });

  it('walks the stages it is going to run', async () => {
    const state = createCityState(
      fakeLayoutClient() as never,
      stubPlacementClient() as never,
      createTestCityResources(),
      SETTINGS,
      events
    );
    const tails = await tailsDuring(() => state.applyManifest(manifest('sig-1')));

    // Every stage of the plan, decoration included: the build places the trees
    // itself, so the walk no longer stops one short.
    expect(tails).toEqual(['0% icons', '25% layout', '50% buildings', '75% trees']);
  });

  it('counts against a shorter plan when the apply has less to do', async () => {
    const state = createCityState(
      fakeLayoutClient() as never,
      stubPlacementClient() as never,
      createTestCityResources(),
      SETTINGS,
      events
    );
    await state.applyManifest(manifest('sig-1'));
    // Same structure signature: the atlas is already right for this tree, so
    // that stage never runs and must not be promised.
    const tails = await tailsDuring(() => state.applyManifest(manifest('sig-1')));

    expect(tails).toEqual(['0% layout', '33% buildings', '67% trees']);
  });

  it('carries the packer percent while it packs', async () => {
    const state = createCityState(
      fakeLayoutClient([7, 61]) as never,
      stubPlacementClient() as never,
      createTestCityResources(),
      SETTINGS,
      events
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
        (
          _m: Manifest,
          _cfg: LayoutConfig,
          _reuse?: CityLayout | null,
          onProgress?: (p: number) => void
        ) => {
          loserProgress ??= onProgress;
          return new Promise<CityLayout>(() => {}); // never resolves
        }
      ),
      dispose: vi.fn(),
    };
    const state = createCityState(
      client as never,
      stubPlacementClient() as never,
      createTestCityResources(),
      SETTINGS,
      events
    );

    void state.applyManifest(manifest('sig-1'));
    void state.applyManifest(manifest('sig-2')); // supersedes the first
    const before = tracked.status.fraction;
    loserProgress?.(80);

    // The loser's percent must not walk over the live build's readout: what it
    // reported is 80%, and the readout has not moved at all.
    expect(tracked.status.fraction).toBe(before);
  });
});
