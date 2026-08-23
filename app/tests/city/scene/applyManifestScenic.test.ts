// applyManifest's reuse gate keys on layout_signature: the same signature
// reuses the packed layout and leaves the scenic components alone.

import { describe, it, expect, afterEach, vi } from 'vitest';

import { createCityBuild } from '@/city/scene/build';
import { createStreets } from '@/city/scene/components/streets';
import { NodeKind, StreetAxis } from '@/types';
import type { CityLayout, DateRanges, Manifest, Street } from '@/types';
import {
  makeSceneContext,
  stubPlacementClient,
  makeBuildingMaterial,
} from '../../_helpers/cityFixtures';
import { makeSession } from '../../_helpers/city';

// One city for this file, the way the app makes one for itself.
const session = makeSession();

function makeRootStreet(): Street {
  return {
    x: 0,
    y: 0,
    width: 32,
    length: 600,
    label: 'root',
    orientation: StreetAxis.X,
    isRoot: true,
    dir: { name: 'root', path: '.', type: NodeKind.Directory },
  } as unknown as Street;
}

const EMPTY_DATE_RANGES: DateRanges = {
  minCreated: null,
  maxCreated: null,
  minModified: null,
  maxModified: null,
} as unknown as DateRanges;

function makeManifest(treeSig: string): Manifest {
  return {
    tree: { type: 'directory', name: treeSig, path: '.', children: [] },
    structure_signature: treeSig,
    layout_signature: treeSig,
    dateRanges: EMPTY_DATE_RANGES,
    commits: [],
    busyness: { avg: 1, busy: 1 },
  } as unknown as Manifest;
}

// A distinct layout per compute, unless reuseLayoutFrom is supplied: that returns
// the same reference, the worker's reuse contract that lets scenic effects skip.
function makeLayoutClient(makeLayout: () => CityLayout) {
  return {
    compute: vi.fn(async (_m: Manifest, reuseFrom?: CityLayout | null) => {
      return reuseFrom ?? makeLayout();
    }),
    dispose: vi.fn(),
  };
}

describe('build.applyManifest — scenic reactivity parity', () => {
  const disposers: Array<() => void> = [];
  afterEach(() => {
    while (disposers.length) disposers.pop()!();
    vi.restoreAllMocks();
  });

  function setup() {
    const layoutClient = makeLayoutClient(
      () =>
        ({
          buildings: [{ x: 0, y: 0, w: 10, d: 10, h: 20 }],
          streets: [makeRootStreet()],
          lineStats: { min: 0, max: 0 },
          byteStats: { min: 0, max: 0 },
          bbox: { minX: -300, minY: -16, maxX: 300, maxY: 16, cx: 0, cy: 0, width: 600, depth: 32 },
        }) as unknown as CityLayout
    );

    const build = createCityBuild(
      layoutClient as never,
      stubPlacementClient() as never,
      session.progress,
      makeBuildingMaterial(),
      session.config
    );
    const streets = createStreets(makeSceneContext(build));
    disposers.push(() => streets.dispose());

    return { build, streets, layoutClient };
  }

  it('#2 non-reuse: applying a manifest builds the streets group and a non-empty bbox', async () => {
    const { build, streets } = setup();
    await build.applyManifest(makeManifest('sig-1'));

    // The streets effect ran inside the batch → group populated.
    expect(streets.group.children.length).toBeGreaterThan(0);
    expect(streets.getPickables().length).toBe(1);
    // #5: bbox was computed AFTER the streets group was populated (so it's not
    // the empty fallback — it covers the real street + building footprint).
    const bbox = build.bbox.value;
    expect(bbox).not.toBeNull();
    expect(bbox!.isEmpty()).toBe(false);
    // latestWorldBounds was set on the non-reuse path.
    expect(build.latestWorldBounds.value).not.toBeNull();
  });

  it('#1 scenic-reuse: re-applying the SAME structure_signature does NOT rebuild streets', async () => {
    const { build, streets, layoutClient } = setup();
    await build.applyManifest(makeManifest('sig-1'));
    const pickablesAfterFirst = streets.getPickables();
    const layoutAfterFirst = build.layout.value;
    const bboxAfterFirst = build.bbox.value;

    // Same structure_signature → cache hit → the same layout reference back →
    // layout.value not reassigned → the streets effect does NOT re-fire.
    await build.applyManifest(makeManifest('sig-1'));

    // Reuse was actually exercised (compute got the prior layout to reuse on the 2nd call).
    expect(layoutClient.compute.mock.calls[1][1]).toBe(layoutAfterFirst);
    // No streets rebuild: same pickables array reference, same layout + bbox.
    expect(streets.getPickables()).toBe(pickablesAfterFirst);
    expect(build.layout.value).toBe(layoutAfterFirst);
    expect(build.bbox.value).toBe(bboxAfterFirst);
  });

  it('#2 invalidate-then-reapply (structural Save): a new layout reference rebuilds streets', async () => {
    const { build, streets } = setup();
    await build.applyManifest(makeManifest('sig-1'));
    const pickablesAfterFirst = streets.getPickables();

    // Simulate the config-Save path: invalidate the layout cache so the next
    // apply of the SAME manifest takes the non-reuse branch (new layout object).
    build.invalidateLayoutCache();
    await build.applyManifest(makeManifest('sig-1'));

    expect(streets.getPickables()).not.toBe(pickablesAfterFirst);
  });

  it('#6 supersede: overlapping applies land the winning layout once', async () => {
    const { build, streets } = setup();
    // Fire two applies without awaiting the first; the second bumps the
    // generation and the first bails at its post-compute generation check.
    const p1 = build.applyManifest(makeManifest('sig-1'));
    const p2 = build.applyManifest(makeManifest('sig-2'));
    await Promise.all([p1, p2]);

    // The winning (last) apply owns the final state: structure_signature sig-2.
    expect(build.manifest.value!.structure_signature).toBe('sig-2');
    // Streets were built (exactly once for the winner — the loser bailed
    // before reassigning layout.value).
    expect(streets.getPickables().length).toBe(1);
    expect(build.bbox.value).not.toBeNull();
  });
});
