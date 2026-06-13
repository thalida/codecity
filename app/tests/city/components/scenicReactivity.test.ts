// scenicReactivity.test.ts — parity tests for Stage 4 Commit 2.
//
// The SYNC scenic components (streets / gem / footprint / island / repoLabel)
// no longer get called in order by applyManifest. Each runs an effect reading
// the cityState signal it depends on and rebuilds when that signal's VALUE
// (object reference) changes. applyManifest reassigns layout/bbox/
// latestWorldBounds ONLY on a non-reuse apply, so on a scenic-reuse apply the
// references stay stable and the effects DON'T re-fire — that reference-
// stability IS the gate that replaced the old scenic-config-hash comparison.
//
// These tests drive the cityState signals directly (the new reactive entry
// point applyManifest writes through). Each component's effect calls its
// rebuild via a closure binding (not the public object property), so we observe
// rebuilds through a per-rebuild SIDE EFFECT — the fresh object reference each
// rebuild swaps in (pickables array / inner gem group / footprint mesh / island
// geometry). Same-reference signal writes must NOT swap, proving the skip.

import { describe, it, expect, afterEach } from 'vitest';
import * as THREE from 'three';

import { createCityState } from '@/city/state';
import { createStreets } from '@/city/components/streets';
import { createGem } from '@/city/components/gem';
import { createIsland } from '@/city/components/island';
import { createRepoLabel } from '@/city/components/repoLabel';
import { NodeKind, StreetAxis } from '@/types';
import type { CityLayout, Manifest, Street } from '@/types';
import type { WorldBounds } from '@/city/utils/floorBounds';
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

// A fresh CityLayout OBJECT each call (new reference) wrapping the given (or a
// default) root street. Distinct calls produce distinct references — exactly
// what a non-reuse applyManifest produces.
function makeLayout(street: Street = makeRootStreet()): CityLayout {
  return {
    buildings: [{ x: 0, y: 0, w: 10, d: 10, h: 20 }],
    streets: [street],
    lineStats: { min: 0, max: 0 },
    byteStats: { min: 0, max: 0 },
    bbox: { minX: -300, minY: -16, maxX: 300, maxY: 16, cx: 0, cy: 0, width: 600, depth: 32 },
  } as unknown as CityLayout;
}

function makeBounds(halfWidth: number): WorldBounds {
  return { cx: 0, cz: 0, halfWidth, halfDepth: halfWidth };
}

function makeManifest(name: string): Manifest {
  return {
    tree: { type: 'directory', name, children: [] },
    tree_signature: name,
    dateRanges: { createdMin: null, createdMax: null, modifiedMin: null, modifiedMax: null },
  } as unknown as Manifest;
}

describe('scenic reactivity — reference-stability gates rebuilds', () => {
  const disposers: Array<() => void> = [];
  afterEach(() => {
    while (disposers.length) disposers.pop()!();
  });

  // ---- Parity #1 + #2: streets rebuild on non-reuse, skip on reuse -----------

  it('streets: rebuilds on a NEW layout reference, skips on the SAME reference', () => {
    const cityState = createCityState();
    const streets = createStreets(makeCtx(cityState));
    disposers.push(() => streets.dispose());

    const layoutA = makeLayout();

    // First non-reuse apply: new reference → rebuild swaps in a fresh
    // pickables array (the per-rebuild side effect we observe).
    cityState.layout.value = layoutA;
    const afterFirst = streets.pickables();
    expect(afterFirst).toHaveLength(1);

    // Scenic-reuse apply: same reference re-assigned → effect does NOT re-fire,
    // so the pickables array is the SAME reference (no rebuild).
    cityState.layout.value = layoutA;
    expect(streets.pickables()).toBe(afterFirst);

    // Another non-reuse apply: a brand-new layout object → rebuild swaps in a
    // NEW pickables array.
    cityState.layout.value = makeLayout();
    expect(streets.pickables()).not.toBe(afterFirst);
  });

  // ---- Parity #1 + #2 + #3: gem rebuilds via rootStreet (computed off layout)

  it('gem: rebuilds when rootStreet changes (new layout), skips on reuse', () => {
    const cityState = createCityState();
    const gem = createGem(makeCtx(cityState));
    disposers.push(() => gem.dispose());

    const layoutA = makeLayout();
    cityState.layout.value = layoutA;
    const gemAfterFirst = gem.gem; // fresh inner gem group from rebuild
    expect(gemAfterFirst).not.toBeNull();

    // Reuse: same layout reference → rootStreet computed is reference-stable →
    // gem effect does NOT re-fire (no flash / GPU realloc): same inner group.
    cityState.layout.value = layoutA;
    expect(gem.gem).toBe(gemAfterFirst);

    // Parity #3: a structural settings change goes through invalidateLayoutCache
    // → the next apply hands a NEW layout object (different reference) even for
    // the same tree. rootStreet re-derives a new Street reference → gem rebuilds
    // (new inner group).
    cityState.layout.value = makeLayout();
    expect(gem.gem).not.toBe(gemAfterFirst);
  });

  // NOTE: footprint is intentionally NOT reactive off layout — it rebuilds on
  // EVERY applyManifest (an explicit call). Its slabs wrap each building's rect,
  // and building w/d/h are recomputed from fresh per-file metadata on a layout-
  // reuse apply (skeleton→final / live update), so a reference-stability skip
  // would leave the footprint mismatched to the buildings. It therefore lives in
  // the "always rebuild" group with buildings, covered by the footprint
  // component tests + the applyManifest integration test (not here).

  // ---- Parity #5: island resizes on new bounds, skips on stable bounds -------

  it('island: setBounds fires on a NEW latestWorldBounds reference, skips on reuse', () => {
    const cityState = createCityState();
    const island = createIsland(makeCtx(cityState));
    disposers.push(() => island.dispose());

    // The island mesh is group.children[0]; setBounds swaps its geometry.
    const mesh = island.group.children[0] as THREE.Mesh;
    const boundsA = makeBounds(25);

    cityState.latestWorldBounds.value = boundsA;
    const geomAfterFirst = mesh.geometry;

    cityState.latestWorldBounds.value = boundsA; // reuse → no resize
    expect(mesh.geometry).toBe(geomAfterFirst);

    cityState.latestWorldBounds.value = makeBounds(40); // non-reuse → resize
    expect(mesh.geometry).not.toBe(geomAfterFirst);
  });

  // ---- repoLabel: repositions every apply (manifest changes every apply) -----

  it('repoLabel: repositions on every manifest change (name + anchor)', () => {
    const cityState = createCityState();
    const label = createRepoLabel(makeCtx(cityState), { getGem: () => null });
    disposers.push(() => label.dispose());

    cityState.manifest.value = makeManifest('repo-a');
    // setRepoName built the panel + beam meshes for repo-a.
    expect(label.group.children.length).toBeGreaterThan(0);
    const panelBoundsA = label.getPanelBounds();
    expect(panelBoundsA).not.toBeNull();

    // A new manifest with a longer name → the panel aspect (width) changes,
    // proving setRepoName re-ran on the manifest change.
    cityState.manifest.value = makeManifest('a-much-longer-repo-name-than-repo-a');
    const panelBoundsB = label.getPanelBounds();
    expect(panelBoundsB).not.toBeNull();
    expect(panelBoundsB!.halfWidth).not.toBeCloseTo(panelBoundsA!.halfWidth, 3);
  });
});
