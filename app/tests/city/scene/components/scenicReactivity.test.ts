// applyManifest reassigns layout/bbox/latestWorldBounds only on a non-reuse
// apply, so on a reuse apply the references hold and each scenic component's
// effect does not re-fire. Rebuilds are observed through a side effect: an
// effect calls its rebuild through a closure, so a spy on it sees nothing.

import { describe, it, expect, afterEach } from 'vitest';
import * as THREE from 'three';

import { makeCityState, makeSceneContext } from '../../../_helpers/cityFixtures';
import { createStreets } from '@/city/scene/components/streets';
import { createGem } from '@/city/scene/components/gem';
import { createIsland } from '@/city/scene/components/island';
import { createRepoLabel } from '@/city/scene/components/repoLabel';
import { NodeKind, StreetAxis } from '@/types';
import type { CityLayout, Manifest, Street } from '@/types';

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

// A fresh CityLayout OBJECT each call, so distinct calls produce distinct
// references: exactly what a non-reuse applyManifest produces.
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
function applyStructure(build: ReturnType<typeof makeCityState>, layout: CityLayout): void {
  build.layout.value = layout;
  build.structureRevision.value++;
}

describe('scenic reactivity — structureRevision gates rebuilds', () => {
  const disposers: Array<() => void> = [];
  afterEach(() => {
    while (disposers.length) disposers.pop()!();
  });

  // ---- Parity #1 + #2: streets rebuild on non-reuse, skip on reuse -----------

  it('streets: rebuilds on a structure change, skips on a reuse apply', () => {
    const build = makeCityState();
    const streets = createStreets(makeSceneContext(build));
    disposers.push(() => streets.dispose());

    // First structure apply (structureRevision bumps) → rebuild swaps in a fresh
    // pickables array (the per-rebuild side effect we observe).
    applyStructure(build, makeLayout());
    const afterFirst = streets.getPickables();
    expect(afterFirst).toHaveLength(1);

    // Reuse apply: layout reassigned (fresh dims) but structureRevision NOT
    // bumped → the streets effect does NOT re-fire (same pickables array).
    build.layout.value = makeLayout();
    expect(streets.getPickables()).toBe(afterFirst);

    // Another structure change → rebuild swaps in a NEW pickables array.
    applyStructure(build, makeLayout());
    expect(streets.getPickables()).not.toBe(afterFirst);
  });

  // ---- Parity #1 + #2 + #3: gem rebuilds via rootStreet (computed off structureRevision)

  it('gem: rebuilds on a structure change, skips on a reuse apply', () => {
    const build = makeCityState();
    const gem = createGem(makeSceneContext(build));
    disposers.push(() => gem.dispose());

    applyStructure(build, makeLayout());
    const gemAfterFirst = gem.getRootGroup(); // fresh inner gem group from rebuild
    expect(gemAfterFirst).not.toBeNull();

    // Reuse: layout reassigned but structureRevision NOT bumped → rootStreet
    // stays cached → gem effect does NOT re-fire (no flash / GPU realloc).
    build.layout.value = makeLayout();
    expect(gem.getRootGroup()).toBe(gemAfterFirst);

    // Structure change → rootStreet recomputes a new Street → gem rebuilds.
    applyStructure(build, makeLayout());
    expect(gem.getRootGroup()).not.toBe(gemAfterFirst);
  });

  // Footprint is deliberately absent: its slabs wrap building rects, which a
  // reuse apply recomputes, so skipping on stable references would mismatch it.

  // ---- Parity #5: island resizes on new bounds, skips on stable bounds -------

  it('island: resizes on a structure change, skips on a reuse apply', () => {
    const build = makeCityState();
    const island = createIsland(makeSceneContext(build));
    disposers.push(() => island.dispose());

    // The island mesh is group.children[0]; setBounds swaps its geometry.
    const mesh = island.group.children[0] as THREE.Mesh;

    // latestWorldBounds is a computed off sceneBbox (→ structureRevision), so a
    // structure apply produces fresh bounds → the island resizes.
    applyStructure(build, makeLayout());
    const geomAfterFirst = mesh.geometry;

    // Reuse: layout reassigned but structureRevision NOT bumped → sceneBbox +
    // latestWorldBounds stay cached → the island does NOT resize.
    build.layout.value = makeLayout();
    expect(mesh.geometry).toBe(geomAfterFirst);

    // Another structure change → fresh bounds → resize.
    applyStructure(build, makeLayout());
    expect(mesh.geometry).not.toBe(geomAfterFirst);
  });

  // ---- repoLabel: repositions every apply (manifest changes every apply) -----

  it('repoLabel: repositions on every manifest change (name + anchor)', () => {
    const build = makeCityState();
    const label = createRepoLabel(makeSceneContext(build), { getGem: () => null });
    disposers.push(() => label.dispose());

    build.manifest.value = makeManifest('repo-a');
    // setRepoName built the panel + beam meshes for repo-a.
    expect(label.group.children.length).toBeGreaterThan(0);
    const panelBoundsA = label.getPanelBounds();
    expect(panelBoundsA).not.toBeNull();

    // A new manifest with a longer name → the panel aspect (width) changes,
    // proving setRepoName re-ran on the manifest change.
    build.manifest.value = makeManifest('a-much-longer-repo-name-than-repo-a');
    const panelBoundsB = label.getPanelBounds();
    expect(panelBoundsB).not.toBeNull();
    expect(panelBoundsB!.halfWidth).not.toBeCloseTo(panelBoundsA!.halfWidth, 3);
  });
});
