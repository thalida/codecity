// applyManifest reassigns layout/bbox/latestWorldBounds only on a non-reuse
// apply, so on a reuse apply the references stay stable and each scenic
// component's effect does not re-fire. That reference stability is the gate.
//
// Rebuilds are observed through a per-rebuild side effect rather than a spy:
// each effect calls its rebuild via a closure binding, not the public property.
//

import { describe, it, expect, afterEach } from 'vitest';
import * as THREE from 'three';

import { makeCityState, makeSceneContext } from '../../_helpers/cityFixtures';
import { createStreets } from '@/city/components/streets';
import { createGem } from '@/city/components/gem';
import { createIsland } from '@/city/components/island';
import { createRepoLabel } from '@/city/components/repoLabel';
import { Manifest, NodeKind } from '@/city/types/manifest';
import { CityLayout } from '@/city/types/scene';
import { Street, StreetAxis } from '@/city/types/street';

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

function makeManifest(name: string): Manifest {
  return {
    tree: { type: 'directory', name, children: [] },
    structure_signature: name,
    layout_signature: name,
    dateRanges: { minCreated: null, maxCreated: null, minModified: null, maxModified: null },
  } as unknown as Manifest;
}

// Structure-change apply: set layout + bump the structureRevision tick the
// structure-reactive consumers track. (A reuse apply sets layout WITHOUT bumping.)
function applyStructure(cityState: ReturnType<typeof makeCityState>, layout: CityLayout): void {
  cityState.layout.value = layout;
  cityState.structureRevision.value++;
}

describe('scenic reactivity — structureRevision gates rebuilds', () => {
  const disposers: Array<() => void> = [];
  afterEach(() => {
    while (disposers.length) disposers.pop()!();
  });

  // ---- Parity #1 + #2: streets rebuild on non-reuse, skip on reuse -----------

  it('streets: rebuilds on a structure change, skips on a reuse apply', () => {
    const cityState = makeCityState();
    const streets = createStreets(makeSceneContext(cityState));
    disposers.push(() => streets.dispose());

    // First structure apply (structureRevision bumps) → rebuild swaps in a fresh
    // pickables array (the per-rebuild side effect we observe).
    applyStructure(cityState, makeLayout());
    const afterFirst = streets.getPickables();
    expect(afterFirst).toHaveLength(1);

    // Reuse apply: layout reassigned (fresh dims) but structureRevision NOT
    // bumped → the streets effect does NOT re-fire (same pickables array).
    cityState.layout.value = makeLayout();
    expect(streets.getPickables()).toBe(afterFirst);

    // Another structure change → rebuild swaps in a NEW pickables array.
    applyStructure(cityState, makeLayout());
    expect(streets.getPickables()).not.toBe(afterFirst);
  });

  // ---- Parity #1 + #2 + #3: gem rebuilds via rootStreet (computed off structureRevision)

  it('gem: rebuilds on a structure change, skips on a reuse apply', () => {
    const cityState = makeCityState();
    const gem = createGem(makeSceneContext(cityState));
    disposers.push(() => gem.dispose());

    applyStructure(cityState, makeLayout());
    const gemAfterFirst = gem.getRootGroup(); // fresh inner gem group from rebuild
    expect(gemAfterFirst).not.toBeNull();

    // Reuse: layout reassigned but structureRevision NOT bumped → rootStreet
    // stays cached → gem effect does NOT re-fire (no flash / GPU realloc).
    cityState.layout.value = makeLayout();
    expect(gem.getRootGroup()).toBe(gemAfterFirst);

    // Structure change → rootStreet recomputes a new Street → gem rebuilds.
    applyStructure(cityState, makeLayout());
    expect(gem.getRootGroup()).not.toBe(gemAfterFirst);
  });

  // NOTE: footprint is intentionally NOT reactive off layout — it rebuilds on
  // EVERY applyManifest (an explicit call). Its slabs wrap each building's rect,
  // and building w/d/h are recomputed from fresh per-file metadata on a layout-
  // reuse apply (skeleton→final / live update), so a reference-stability skip
  // would leave the footprint mismatched to the buildings. It therefore lives in
  // the "always rebuild" group with buildings, covered by the footprint
  // component tests + the applyManifest integration test (not here).

  // ---- Parity #5: island resizes on new bounds, skips on stable bounds -------

  it('island: resizes on a structure change, skips on a reuse apply', () => {
    const cityState = makeCityState();
    const island = createIsland(makeSceneContext(cityState));
    disposers.push(() => island.dispose());

    // The island mesh is group.children[0]; setBounds swaps its geometry.
    const mesh = island.group.children[0] as THREE.Mesh;

    // latestWorldBounds is a computed off sceneBbox (→ structureRevision), so a
    // structure apply produces fresh bounds → the island resizes.
    applyStructure(cityState, makeLayout());
    const geomAfterFirst = mesh.geometry;

    // Reuse: layout reassigned but structureRevision NOT bumped → sceneBbox +
    // latestWorldBounds stay cached → the island does NOT resize.
    cityState.layout.value = makeLayout();
    expect(mesh.geometry).toBe(geomAfterFirst);

    // Another structure change → fresh bounds → resize.
    applyStructure(cityState, makeLayout());
    expect(mesh.geometry).not.toBe(geomAfterFirst);
  });

  // ---- repoLabel: repositions every apply (manifest changes every apply) -----

  it('repoLabel: repositions on every manifest change (name + anchor)', () => {
    const cityState = makeCityState();
    const label = createRepoLabel(makeSceneContext(cityState), { getGem: () => null });
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
