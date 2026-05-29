// app/tests/scene/fireflies/orbitRings.test.ts
//
// Unit tests for the lazy 2-slot orbit-ring pool. The pool is exercised
// in isolation (not through createFireflies) so failures point at the
// pool itself, not the surrounding renderer wiring.

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createOrbitRings } from '@/scene/components/fireflies/orbitRings.js';
import type { FireflyPlacement } from '@/scene/components/fireflies/firefliesPlacement.js';
import { FIREFLIES } from '@/config/components/fireflies.js';

const RING_GROUP_NAME = 'firefly-orbit-rings';

function makePlacement(commitIndex: number): FireflyPlacement {
  return {
    treeX: commitIndex * 10,
    treeZ: 0,
    height: 5,
    orbitRadius: 2,
    orbitStartAngle: 0,
    orbitTilt: 0.2,
    phase: 0,
    pulsePhase: 0,
    colorHex: '#ffffff',
    rgb: [1, 1, 1],
    scale: 1,
    commitIndex,
  };
}

const PLACEMENTS: FireflyPlacement[] = [
  makePlacement(0),
  makePlacement(1),
  makePlacement(2),
];

function meshesIn(rings: ReturnType<typeof createOrbitRings>): THREE.Mesh[] {
  return rings.group.children.filter(
    (c): c is THREE.Mesh => (c as THREE.Mesh).isMesh === true
  );
}

function colorOf(mesh: THREE.Mesh): THREE.Color {
  const mat = mesh.material as THREE.MeshBasicMaterial;
  return mat.color;
}

describe('createOrbitRings — lazy pool', () => {
  it('returns an empty group at construction (no upfront geometry)', () => {
    const rings = createOrbitRings(PLACEMENTS);
    expect(rings.group.name).toBe(RING_GROUP_NAME);
    expect(meshesIn(rings).length).toBe(0);
    rings.dispose();
  });

  it('returns the no-op interface when placements is empty', () => {
    const rings = createOrbitRings([]);
    expect(() => rings.setHoveredCommit(0)).not.toThrow();
    expect(() => rings.setSelectedCommit(0)).not.toThrow();
    expect(meshesIn(rings).length).toBe(0);
    rings.dispose();
  });

  it('setHoveredCommit(idx) builds exactly one mesh in the group', () => {
    const rings = createOrbitRings(PLACEMENTS);
    rings.setHoveredCommit(0);
    const ms = meshesIn(rings);
    expect(ms.length).toBe(1);
    const geom = ms[0].geometry as THREE.BufferGeometry;
    const posAttr = geom.getAttribute('position');
    expect(posAttr).toBeDefined();
    expect(posAttr.count).toBeGreaterThan(0);
    rings.dispose();
  });

  it('setHoveredCommit with the same idx twice is a no-op (geometry identity preserved)', () => {
    const rings = createOrbitRings(PLACEMENTS);
    rings.setHoveredCommit(1);
    const geomBefore = meshesIn(rings)[0].geometry;
    rings.setHoveredCommit(1);
    const geomAfter = meshesIn(rings)[0].geometry;
    expect(geomAfter).toBe(geomBefore);
    rings.dispose();
  });

  it('setHoveredCommit(a) then (b) disposes the old geometry and builds a new one', () => {
    const rings = createOrbitRings(PLACEMENTS);
    rings.setHoveredCommit(0);
    const oldGeom = meshesIn(rings)[0].geometry as THREE.BufferGeometry;
    let disposed = false;
    oldGeom.addEventListener('dispose', () => {
      disposed = true;
    });
    rings.setHoveredCommit(2);
    const newGeom = meshesIn(rings)[0].geometry as THREE.BufferGeometry;
    expect(disposed).toBe(true);
    expect(newGeom).not.toBe(oldGeom);
    rings.dispose();
  });

  it('setHoveredCommit(null) disposes the hover slot mesh', () => {
    const rings = createOrbitRings(PLACEMENTS);
    rings.setHoveredCommit(0);
    expect(meshesIn(rings).length).toBe(1);
    rings.setHoveredCommit(null);
    expect(meshesIn(rings).length).toBe(0);
    rings.dispose();
  });

  it('setSelectedCommit(idx) builds a mesh with the selected color', () => {
    const rings = createOrbitRings(PLACEMENTS);
    rings.setSelectedCommit(0);
    const ms = meshesIn(rings);
    expect(ms.length).toBe(1);
    const expected = new THREE.Color(FIREFLIES.get().ORBIT_RING_SELECTED_COLOR);
    const got = colorOf(ms[0]);
    expect(got.r).toBeCloseTo(expected.r, 4);
    expect(got.g).toBeCloseTo(expected.g, 4);
    expect(got.b).toBeCloseTo(expected.b, 4);
    rings.dispose();
  });

  it('hover + selected on the same commit shows only the selected mesh', () => {
    const rings = createOrbitRings(PLACEMENTS);
    rings.setHoveredCommit(0);
    rings.setSelectedCommit(0);
    const ms = meshesIn(rings);
    expect(ms.length).toBe(1);
    const expected = new THREE.Color(FIREFLIES.get().ORBIT_RING_SELECTED_COLOR);
    expect(colorOf(ms[0]).r).toBeCloseTo(expected.r, 4);
    rings.dispose();
  });

  it('hover + selected on different commits shows two meshes with distinct colors', () => {
    const rings = createOrbitRings(PLACEMENTS);
    rings.setHoveredCommit(0);
    rings.setSelectedCommit(1);
    const ms = meshesIn(rings);
    expect(ms.length).toBe(2);
    const hoverColor = new THREE.Color(FIREFLIES.get().ORBIT_RING_HOVER_COLOR);
    const selColor = new THREE.Color(FIREFLIES.get().ORBIT_RING_SELECTED_COLOR);
    const colors = ms.map((m) => colorOf(m).getHexString());
    expect(colors).toContain(hoverColor.getHexString());
    expect(colors).toContain(selColor.getHexString());
    rings.dispose();
  });

  it('deselecting while still hovered restores the hover ring', () => {
    const rings = createOrbitRings(PLACEMENTS);
    rings.setHoveredCommit(0);
    rings.setSelectedCommit(0);
    // After selecting the hovered commit, only the selected mesh is visible.
    expect(meshesIn(rings).length).toBe(1);
    rings.setSelectedCommit(null);
    // Selection cleared; the hover state is still on commit 0, so the
    // hover slot's mesh comes back.
    const ms = meshesIn(rings);
    expect(ms.length).toBe(1);
    const expected = new THREE.Color(FIREFLIES.get().ORBIT_RING_HOVER_COLOR);
    expect(colorOf(ms[0]).r).toBeCloseTo(expected.r, 4);
    rings.dispose();
  });

  it('refresh() updates the active slot materials when hover/selected colors change', () => {
    const rings = createOrbitRings(PLACEMENTS);
    rings.setHoveredCommit(0);
    const orig = FIREFLIES.get().ORBIT_RING_HOVER_COLOR;
    FIREFLIES.setKey('ORBIT_RING_HOVER_COLOR', '#00ff00');
    try {
      rings.refresh();
      const expected = new THREE.Color('#00ff00');
      expect(colorOf(meshesIn(rings)[0]).r).toBeCloseTo(expected.r, 4);
      expect(colorOf(meshesIn(rings)[0]).g).toBeCloseTo(expected.g, 4);
      expect(colorOf(meshesIn(rings)[0]).b).toBeCloseTo(expected.b, 4);
    } finally {
      FIREFLIES.setKey('ORBIT_RING_HOVER_COLOR', orig);
    }
    rings.dispose();
  });

  it('dispose() clears the group and is idempotent', () => {
    const rings = createOrbitRings(PLACEMENTS);
    rings.setHoveredCommit(0);
    rings.setSelectedCommit(1);
    rings.dispose();
    expect(meshesIn(rings).length).toBe(0);
    expect(() => rings.dispose()).not.toThrow();
  });

  it('factory does zero upfront geometry; setHoveredCommit stays fast at 100k placements', () => {
    // Two assertions cover the spec invariants:
    //   1. Structural: the factory must not build any ring meshes upfront.
    //      A regression that loops over placements and builds geometry
    //      would fail here regardless of timing noise.
    //   2. Performance: a single hover after a 100k-placement factory
    //      must still feel instant.
    const big: FireflyPlacement[] = Array.from({ length: 100_000 }, (_, i) =>
      makePlacement(i)
    );
    const rings = createOrbitRings(big);
    expect(meshesIn(rings).length).toBe(0);

    const t0 = performance.now();
    rings.setHoveredCommit(50_000);
    const elapsed = performance.now() - t0;
    expect(meshesIn(rings).length).toBe(1);
    expect(elapsed).toBeLessThan(200);

    rings.dispose();
  });
});
