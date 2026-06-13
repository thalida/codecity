// applyManifestScenic.test.ts — integration parity tests for Stage 4 Commit 2
// at the createApplyManifest level. Drives the real pipeline factory with the
// REAL streets component + real cityState (so the batch ordering + bbox-after-
// streets-group-populated invariant is genuinely exercised) and lightweight
// stubs for the rest of the components and the off-thread clients.
//
// Covers the parity-bar items that are applyManifest-level (not pure component
// reactivity):
//   #1  scenic-reuse → no streets rebuild (same layout reference reused)
//   #2  non-reuse → streets rebuild
//   #5  bbox computed AFTER the streets group is populated (batch ordering)
//   #6  supersede → the winning apply's layout is the one that lands

import { describe, it, expect, afterEach, vi } from 'vitest';
import * as THREE from 'three';

import { createApplyManifest } from '@/city/state/applyManifest';
import { createCityState } from '@/city/state';
import { createStreets } from '@/city/components/streets';
import { NodeKind, StreetAxis } from '@/types';
import type { CityLayout, DateRanges, Manifest, Street } from '@/types';
import type { Picker } from '@/city/interaction/picker';
import type { SceneContext } from '@/city/types';

function makeCtx(cityState: ReturnType<typeof createCityState>): SceneContext {
  return {
    scene: new THREE.Scene(),
    picker: null as unknown as Picker,
    camera: null as unknown as THREE.PerspectiveCamera,
    renderer: null as unknown as THREE.WebGLRenderer,
    cityState,
  } as unknown as SceneContext;
}

function makeRootStreet(): Street {
  return {
    x: 0,
    y: 0,
    width: 32,
    length: 600,
    label: 'root',
    orientation: StreetAxis.X,
    isRoot: true,
    dir: { name: 'root', path: '', type: NodeKind.Directory },
  } as unknown as Street;
}

const EMPTY_DATE_RANGES: DateRanges = {
  createdMin: null,
  createdMax: null,
  modifiedMin: null,
  modifiedMax: null,
} as unknown as DateRanges;

function makeManifest(treeSig: string): Manifest {
  return {
    tree: { type: 'directory', name: treeSig, children: [] },
    tree_signature: treeSig,
    dateRanges: EMPTY_DATE_RANGES,
    commits: [],
    busyness: { avg: 1, busy: 1 },
  } as unknown as Manifest;
}

// A no-op stub component exposing whatever subset of the SceneComponent + its
// own contract applyManifest touches. Per-test overrides extend it.
function makeStubComponents() {
  const group = () => new THREE.Group();
  return {
    sky: { group: group(), dispose: vi.fn() },
    island: { group: group(), setBounds: vi.fn(), dispose: vi.fn() },
    repoLabel: {
      group: group(),
      setRepoName: vi.fn(),
      setAnchor: vi.fn(),
      setGem: vi.fn(),
      dispose: vi.fn(),
    },
    footprint: { group: group(), rebuild: vi.fn(), dispose: vi.fn() },
    gem: { group: group(), rebuild: vi.fn(), gem: null, worldPos: null, dispose: vi.fn() },
    buildings: {
      group: group(),
      rebuild: vi.fn(async () => {}),
      setAtlas: vi.fn(),
      disposeAdPanels: vi.fn(),
      getCells: () => new Map(),
      getBuildingIndex: () => null,
      dispose: vi.fn(),
    },
    trees: {
      group: group(),
      rebuild: vi.fn(),
      clear: vi.fn(),
      handle: () => null,
      dispose: vi.fn(),
    },
    fireflies: { group: group(), rebuild: vi.fn(), clear: vi.fn(), dispose: vi.fn() },
    pathLine: { group: group(), dispose: vi.fn() },
  };
}

// layoutClient stub: returns a DISTINCT layout object per compute UNLESS
// reuseLayoutFrom is supplied (the cache-hit path), in which case it returns
// that exact reference — mirroring the worker's reuse contract that keeps
// positions (and the object) stable so the scenic effects skip.
function makeLayoutClient(makeLayout: () => CityLayout) {
  return {
    compute: vi.fn(async (_m: Manifest, opts?: { reuseLayoutFrom?: CityLayout }) => {
      return opts?.reuseLayoutFrom ?? makeLayout();
    }),
    dispose: vi.fn(),
  };
}

describe('createApplyManifest — scenic reactivity parity', () => {
  const disposers: Array<() => void> = [];
  afterEach(() => {
    while (disposers.length) disposers.pop()!();
    vi.restoreAllMocks();
  });

  function setup() {
    const cityState = createCityState();
    const streets = createStreets(makeCtx(cityState));
    disposers.push(() => streets.dispose());
    const stubs = makeStubComponents();
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

    const api = createApplyManifest({
      components: { ...stubs, streets } as never,
      layoutClient: layoutClient as never,
      cityState,
    });
    return { api, cityState, streets, layoutClient, stubs };
  }

  it('#2 non-reuse: applying a manifest builds the streets group and a non-empty bbox', async () => {
    const { api, cityState, streets } = setup();
    await api.applyManifest(makeManifest('sig-1'));

    // The streets effect ran inside the batch → group populated.
    expect(streets.group.children.length).toBeGreaterThan(0);
    expect(streets.pickables().length).toBe(1);
    // #5: bbox was computed AFTER the streets group was populated (so it's not
    // the empty fallback — it covers the real street + building footprint).
    const bbox = cityState.bbox.value;
    expect(bbox).not.toBeNull();
    expect(bbox!.isEmpty()).toBe(false);
    // latestWorldBounds was set on the non-reuse path.
    expect(cityState.latestWorldBounds.value).not.toBeNull();
  });

  it('#1 scenic-reuse: re-applying the SAME tree_signature does NOT rebuild streets', async () => {
    const { api, cityState, streets, layoutClient } = setup();
    await api.applyManifest(makeManifest('sig-1'));
    const pickablesAfterFirst = streets.pickables();
    const layoutAfterFirst = cityState.layout.value;
    const bboxAfterFirst = cityState.bbox.value;

    // Same tree_signature → layout cache hit → layoutClient returns the SAME
    // layout reference (reuseLayoutFrom) → layout.value not reassigned → the
    // streets effect does NOT re-fire.
    await api.applyManifest(makeManifest('sig-1'));

    // Reuse was actually exercised (compute saw reuseLayoutFrom on the 2nd call).
    expect(layoutClient.compute.mock.calls[1][1]).toEqual({
      reuseLayoutFrom: layoutAfterFirst,
    });
    // No streets rebuild: same pickables array reference, same layout + bbox.
    expect(streets.pickables()).toBe(pickablesAfterFirst);
    expect(cityState.layout.value).toBe(layoutAfterFirst);
    expect(cityState.bbox.value).toBe(bboxAfterFirst);
  });

  it('#2 invalidate-then-reapply (structural Save): a new layout reference rebuilds streets', async () => {
    const { api, streets } = setup();
    await api.applyManifest(makeManifest('sig-1'));
    const pickablesAfterFirst = streets.pickables();

    // Simulate the config-Save path: invalidate the layout cache so the next
    // apply of the SAME manifest takes the non-reuse branch (new layout object).
    api.invalidateLayoutCache();
    await api.applyManifest(makeManifest('sig-1'));

    expect(streets.pickables()).not.toBe(pickablesAfterFirst);
  });

  it('#6 supersede: overlapping applies land the winning layout once', async () => {
    const { api, cityState, streets } = setup();
    // Fire two applies without awaiting the first; the second bumps the
    // generation and the first bails at its post-compute generation check.
    const p1 = api.applyManifest(makeManifest('sig-1'));
    const p2 = api.applyManifest(makeManifest('sig-2'));
    await Promise.all([p1, p2]);

    // The winning (last) apply owns the final state: tree_signature sig-2.
    expect(cityState.manifest.value!.tree_signature).toBe('sig-2');
    // Streets were built (exactly once for the winner — the loser bailed
    // before reassigning layout.value).
    expect(streets.pickables().length).toBe(1);
    expect(cityState.bbox.value).not.toBeNull();
  });
});
