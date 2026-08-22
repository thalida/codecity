// Unit tests for the lazy 2-slot orbit-ring pool. The pool is exercised
// in isolation (not through createFireflies) so failures point at the
// pool itself, not the surrounding renderer wiring.

import { FIREFLIES } from '@/state/settings/fields/fireflies';
import { TREES } from '@/state/settings/fields/trees';
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createOrbitRings, ORBIT_RINGS_GROUP } from '@/city/components/fireflies/orbitRings';
import type { FireflyPlacement } from '@/city/components/fireflies/firefliesPlacement';

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
    rgb: [1, 1, 1],
    lightRgb: [0.5, 0.5, 0.5],
    scale: 1,
    author: `Author ${commitIndex}`,
    heightFrac: 0.5,
    orbitRadiusFrac: 1.2,
    commitIndex,
  };
}

const PLACEMENTS: FireflyPlacement[] = [makePlacement(0), makePlacement(1), makePlacement(2)];

function meshesIn(rings: ReturnType<typeof createOrbitRings>): THREE.Mesh[] {
  return rings.group.children.filter((c): c is THREE.Mesh => (c as THREE.Mesh).isMesh === true);
}

describe('createOrbitRings — lazy pool', () => {
  it('returns an empty group at construction (no upfront geometry)', () => {
    const rings = createOrbitRings(PLACEMENTS, FIREFLIES);
    expect(rings.group.name).toBe(ORBIT_RINGS_GROUP);
    expect(meshesIn(rings).length).toBe(0);
    rings.dispose();
  });

  it('returns the no-op interface when placements is empty', () => {
    const rings = createOrbitRings([], FIREFLIES);
    expect(() => rings.setHoveredCommit(0)).not.toThrow();
    expect(() => rings.setSelectedCommit(0)).not.toThrow();
    expect(() => rings.update(0)).not.toThrow();
    expect(meshesIn(rings).length).toBe(0);
    rings.dispose();
  });

  it('setHoveredCommit(idx) builds exactly one mesh in the group', () => {
    const rings = createOrbitRings(PLACEMENTS, FIREFLIES);
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
    const rings = createOrbitRings(PLACEMENTS, FIREFLIES);
    rings.setHoveredCommit(1);
    const geomBefore = meshesIn(rings)[0].geometry;
    rings.setHoveredCommit(1);
    const geomAfter = meshesIn(rings)[0].geometry;
    expect(geomAfter).toBe(geomBefore);
    rings.dispose();
  });

  it('setHoveredCommit(a) then (b) disposes the old geometry and builds a new one', () => {
    const rings = createOrbitRings(PLACEMENTS, FIREFLIES);
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
    const rings = createOrbitRings(PLACEMENTS, FIREFLIES);
    rings.setHoveredCommit(0);
    expect(meshesIn(rings).length).toBe(1);
    rings.setHoveredCommit(null);
    expect(meshesIn(rings).length).toBe(0);
    rings.dispose();
  });

  it('setSelectedCommit(idx) builds a mesh whose material has vertexColors enabled', () => {
    const rings = createOrbitRings(PLACEMENTS, FIREFLIES);
    rings.setSelectedCommit(0);
    const ms = meshesIn(rings);
    expect(ms.length).toBe(1);
    const mat = ms[0].material as THREE.MeshBasicMaterial;
    expect(mat.vertexColors).toBe(true);
    rings.dispose();
  });

  it('hover + selected on the same commit shows only the selected mesh', () => {
    const rings = createOrbitRings(PLACEMENTS, FIREFLIES);
    rings.setHoveredCommit(0);
    rings.setSelectedCommit(0);
    const ms = meshesIn(rings);
    expect(ms.length).toBe(1);
    const mat = ms[0].material as THREE.MeshBasicMaterial;
    expect(mat.vertexColors).toBe(true);
    rings.dispose();
  });

  it('hover + selected on different commits shows two meshes with distinct material strategies', () => {
    const rings = createOrbitRings(PLACEMENTS, FIREFLIES);
    rings.setHoveredCommit(0);
    rings.setSelectedCommit(1);
    const ms = meshesIn(rings);
    expect(ms.length).toBe(2);
    const vcFlags = ms.map((m) => (m.material as THREE.MeshBasicMaterial).vertexColors);
    // Exactly one of each: hover (false) + selected (true).
    expect(vcFlags.filter((v) => v === true).length).toBe(1);
    expect(vcFlags.filter((v) => v === false).length).toBe(1);
    rings.dispose();
  });

  it('deselecting while still hovered restores the hover ring', () => {
    const rings = createOrbitRings(PLACEMENTS, FIREFLIES);
    rings.setHoveredCommit(0);
    rings.setSelectedCommit(0);
    // After selecting the hovered commit, only the selected mesh is visible.
    expect(meshesIn(rings).length).toBe(1);
    rings.setSelectedCommit(null);
    // Selection cleared; the hover state is still on commit 0, so the
    // hover slot's mesh comes back.
    const ms = meshesIn(rings);
    expect(ms.length).toBe(1);
    // The restored mesh is a hover mesh: vertexColors must be false.
    expect((ms[0].material as THREE.MeshBasicMaterial).vertexColors).toBe(false);
    rings.dispose();
  });

  it('dispose() clears the group and is idempotent', () => {
    const rings = createOrbitRings(PLACEMENTS, FIREFLIES);
    rings.setHoveredCommit(0);
    rings.setSelectedCommit(1);
    rings.dispose();
    expect(meshesIn(rings).length).toBe(0);
    expect(() => rings.dispose()).not.toThrow();
  });

  // ── Color strategy (per-author hover, rainbow selected) ──────────────

  it("hover ring uses each orb's lightRgb as material color", () => {
    const placement: FireflyPlacement = {
      ...makePlacement(0),
      lightRgb: [0.9, 0.8, 0.7],
    };
    const rings = createOrbitRings([placement], FIREFLIES);
    rings.setHoveredCommit(0);
    const ms = meshesIn(rings);
    expect(ms.length).toBe(1);
    const mat = ms[0].material as THREE.MeshBasicMaterial;
    expect(mat.color.r).toBeCloseTo(0.9, 3);
    expect(mat.color.g).toBeCloseTo(0.8, 3);
    expect(mat.color.b).toBeCloseTo(0.7, 3);
    rings.dispose();
  });

  it("multi-author hover rings each use that author's lightRgb", () => {
    // Three orbs at the same commitIndex with distinct lightRgb values.
    const placements: FireflyPlacement[] = [0, 1, 2].map((i) => ({
      ...makePlacement(0),
      orbitRadius: 2 + i, // distinct geometry so they don't collapse
      lightRgb: [i / 2, 1 - i / 2, 0.5] as [number, number, number],
    }));
    const rings = createOrbitRings(placements, FIREFLIES);
    rings.setHoveredCommit(0);
    const ms = meshesIn(rings);
    expect(ms.length).toBe(3);
    for (let i = 0; i < 3; i++) {
      const mat = ms[i].material as THREE.MeshBasicMaterial;
      expect(mat.color.r).toBeCloseTo(i / 2, 3);
      expect(mat.color.g).toBeCloseTo(1 - i / 2, 3);
      expect(mat.color.b).toBeCloseTo(0.5, 3);
    }
    rings.dispose();
  });

  it('selected ring material uses vertexColors and gets a color attribute', () => {
    const rings = createOrbitRings(PLACEMENTS, FIREFLIES);
    rings.setSelectedCommit(0);
    rings.update(performance.now());
    const ms = meshesIn(rings);
    const mat = ms[0].material as THREE.MeshBasicMaterial;
    expect(mat.vertexColors).toBe(true);
    const colorAttr = (ms[0].geometry as THREE.BufferGeometry).getAttribute('color');
    expect(colorAttr).toBeDefined();
    expect(colorAttr.count).toBeGreaterThan(0);
    rings.dispose();
  });

  it('update(t) advances rainbow chase on selected rings', () => {
    const rings = createOrbitRings(PLACEMENTS, FIREFLIES);
    rings.setSelectedCommit(0);
    rings.update(0);
    const attr1 = (meshesIn(rings)[0].geometry as THREE.BufferGeometry).getAttribute(
      'color'
    ) as THREE.BufferAttribute;
    const buf1 = Float32Array.from(attr1.array as Float32Array);
    // A second moves the chase half a hue cycle, so it cannot land back on
    // the sample taken at t=0.
    rings.update(1000);
    const attr2 = (meshesIn(rings)[0].geometry as THREE.BufferGeometry).getAttribute(
      'color'
    ) as THREE.BufferAttribute;
    const buf2 = Float32Array.from(attr2.array as Float32Array);
    let differs = false;
    for (let i = 0; i < buf1.length; i++) {
      if (buf1[i] !== buf2[i]) {
        differs = true;
        break;
      }
    }
    expect(differs).toBe(true);
    rings.dispose();
  });

  it('update() is a cheap no-op when nothing is selected', () => {
    const rings = createOrbitRings(PLACEMENTS, FIREFLIES);
    // Only hover; no selected meshes.
    rings.setHoveredCommit(0);
    expect(() => rings.update(0)).not.toThrow();
    expect(() => rings.update(123456)).not.toThrow();
    rings.dispose();
  });

  // ── Multi-author commits (N orbs per commitIndex) ────────────────────

  /** Three orbs at the same commitIndex, each with a distinct orbit shape —
   *  mirrors what placeFireflies emits for a 3-co-author commit. */
  function multiAuthorPlacements(commitIndex: number): FireflyPlacement[] {
    return [
      { ...makePlacement(commitIndex), orbitRadius: 2.0, orbitTilt: 0.1, orbitStartAngle: 0.0 },
      { ...makePlacement(commitIndex), orbitRadius: 3.0, orbitTilt: 0.3, orbitStartAngle: 1.0 },
      { ...makePlacement(commitIndex), orbitRadius: 4.0, orbitTilt: 0.5, orbitStartAngle: 2.0 },
    ];
  }

  it('setHoveredCommit on a multi-author commit builds one ring mesh per author orb', () => {
    const placements = multiAuthorPlacements(0);
    const rings = createOrbitRings(placements, FIREFLIES);
    rings.setHoveredCommit(0);
    // Three co-authors at commit 0 → three orbit rings.
    expect(meshesIn(rings).length).toBe(3);
    rings.dispose();
  });

  it('setSelectedCommit on a multi-author commit builds one ring mesh per author orb', () => {
    const placements = multiAuthorPlacements(0);
    const rings = createOrbitRings(placements, FIREFLIES);
    rings.setSelectedCommit(0);
    expect(meshesIn(rings).length).toBe(3);
    rings.dispose();
  });

  it('hover + selected on different multi-author commits shows N + M rings', () => {
    const placements = [...multiAuthorPlacements(0), ...multiAuthorPlacements(1)];
    const rings = createOrbitRings(placements, FIREFLIES);
    rings.setHoveredCommit(0); // 3 hover rings
    rings.setSelectedCommit(1); // 2 selected rings (different placements at idx 1)
    // multiAuthorPlacements(1) emits 3 orbs too → 3 selected + 3 hover = 6.
    expect(meshesIn(rings).length).toBe(6);
    rings.dispose();
  });

  it('clearing hover on a multi-author commit disposes all of its rings', () => {
    const placements = multiAuthorPlacements(0);
    const rings = createOrbitRings(placements, FIREFLIES);
    rings.setHoveredCommit(0);
    expect(meshesIn(rings).length).toBe(3);
    rings.setHoveredCommit(null);
    expect(meshesIn(rings).length).toBe(0);
    rings.dispose();
  });

  it("multi-author ring geometries reflect each orb's distinct orbit params", () => {
    const placements = multiAuthorPlacements(0);
    const rings = createOrbitRings(placements, FIREFLIES);
    rings.setHoveredCommit(0);
    const ms = meshesIn(rings);
    expect(ms.length).toBe(3);
    // Each tube geometry's bounding sphere radius is roughly proportional
    // to its orbitRadius. Compute and dedupe — three distinct radii expected.
    const radii = new Set<number>();
    for (const m of ms) {
      const geom = m.geometry as THREE.BufferGeometry;
      geom.computeBoundingSphere();
      radii.add(Math.round((geom.boundingSphere?.radius ?? 0) * 100));
    }
    expect(radii.size).toBe(3);
    rings.dispose();
  });

  it('factory does zero upfront geometry; setHoveredCommit stays fast at 100k placements', () => {
    // Structural and timed: the factory must build no rings upfront, and a
    // hover into 100k placements must still feel instant.
    const big: FireflyPlacement[] = Array.from({ length: 100_000 }, (_, i) => makePlacement(i));
    const rings = createOrbitRings(big, FIREFLIES);
    expect(meshesIn(rings).length).toBe(0);

    const t0 = performance.now();
    rings.setHoveredCommit(50_000);
    const elapsed = performance.now() - t0;
    expect(meshesIn(rings).length).toBe(1);
    expect(elapsed).toBeLessThan(200);

    rings.dispose();
  });
});
