import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createFireflies } from '@/scene/components/fireflies/fireflies.js';
import { FIREFLIES } from '@/config/components/fireflies.js';
import type { CommitEntry } from '@/types';
import type { TreePlacement } from '@/scene/components/trees/treePlacement.js';

const COMMITS: CommitEntry[] = [
  { date: '2026-01-01', files: 1, sha: 'a'.repeat(40), author: 'Alice', subject: 'a' },
];

const PLACEMENTS: TreePlacement[] = [{ x: 0, y: 0, commitIndex: 0, seed: 0 } as TreePlacement];

/** Read the RGBA of vertex 0 from the merged ring mesh's colour attribute. */
function getRingVertex0RGBA(ringGroup: THREE.Object3D): {
  r: number;
  g: number;
  b: number;
  a: number;
} {
  const ringMesh = ringGroup.children[0] as THREE.Mesh;
  const colorAttr = ringMesh.geometry.getAttribute('color') as THREE.BufferAttribute;
  return {
    r: colorAttr.getX(0),
    g: colorAttr.getY(0),
    b: colorAttr.getZ(0),
    a: colorAttr.getW(0),
  };
}

describe('createFireflies', () => {
  it('returns a group containing one InstancedMesh (orbs) and one Mesh (rings) when commits is non-empty', () => {
    const f = createFireflies(PLACEMENTS, COMMITS);
    expect(f.group).toBeInstanceOf(THREE.Group);
    // The parent group has two child Groups (rings + renderer).
    // Rings group contains exactly ONE merged Mesh; renderer group contains one InstancedMesh.
    const allDescendants = f.group.children.flatMap((c) => c.children);
    const instancedMeshes = allDescendants.filter((c) => c instanceof THREE.InstancedMesh);
    const tubeMeshes = allDescendants.filter(
      (c) => c instanceof THREE.Mesh && !(c instanceof THREE.InstancedMesh)
    );
    expect(instancedMeshes.length).toBe(1);
    expect(tubeMeshes.length).toBe(1);
    f.dispose();
  });

  it('returns a group with no descendant InstancedMeshes when commits is null', () => {
    const f = createFireflies(PLACEMENTS, null);
    const meshes = f.group.children
      .flatMap((c) => c.children)
      .filter((c) => c instanceof THREE.InstancedMesh);
    expect(meshes.length).toBe(0);
    f.dispose();
  });

  it('returns a group with no descendant InstancedMeshes when placements is empty', () => {
    const f = createFireflies([], COMMITS);
    const meshes = f.group.children
      .flatMap((c) => c.children)
      .filter((c) => c instanceof THREE.InstancedMesh);
    expect(meshes.length).toBe(0);
    f.dispose();
  });

  it('dispose() removes all descendant InstancedMeshes and tube Meshes', () => {
    const f = createFireflies(PLACEMENTS, COMMITS);
    f.dispose();
    const allDescendants = f.group.children.flatMap((c) => c.children);
    const instancedMeshes = allDescendants.filter((c) => c instanceof THREE.InstancedMesh);
    const tubeMeshes = allDescendants.filter(
      (c) => c instanceof THREE.Mesh && !(c instanceof THREE.InstancedMesh)
    );
    expect(instancedMeshes.length).toBe(0);
    expect(tubeMeshes.length).toBe(0);
  });

  it('setTime(t) is a no-op when the group is empty (no instances)', () => {
    const f = createFireflies([], COMMITS);
    expect(() => f.setTime(1.0)).not.toThrow();
    f.dispose();
  });

  it('exposes setHoveredCommit and setSelectedCommit methods', () => {
    const f = createFireflies(PLACEMENTS, COMMITS);
    expect(typeof f.setHoveredCommit).toBe('function');
    expect(typeof f.setSelectedCommit).toBe('function');
    // No-throw on null + valid SHA.
    expect(() => f.setHoveredCommit(null)).not.toThrow();
    expect(() => f.setHoveredCommit(COMMITS[0].sha)).not.toThrow();
    expect(() => f.setSelectedCommit(null)).not.toThrow();
    expect(() => f.setSelectedCommit(COMMITS[0].sha)).not.toThrow();
    f.dispose();
  });

  it("empty renderer's setHoveredCommit and setSelectedCommit are no-ops", () => {
    const f = createFireflies([], COMMITS);
    expect(() => f.setHoveredCommit('abc')).not.toThrow();
    expect(() => f.setSelectedCommit('abc')).not.toThrow();
    f.dispose();
  });

  it('returns an empty group when FIREFLIES_ENABLED is false', () => {
    const orig = FIREFLIES.get().FIREFLIES_ENABLED;
    FIREFLIES.setKey('FIREFLIES_ENABLED', false);
    try {
      const f = createFireflies(PLACEMENTS, COMMITS);
      expect(f.group.children.length).toBe(0);
      f.dispose();
    } finally {
      FIREFLIES.setKey('FIREFLIES_ENABLED', orig);
    }
  });

  it('refresh() updates the ring vertex colour + opacity', () => {
    const orig = {
      color: FIREFLIES.get().ORBIT_RING_COLOR,
      opacity: FIREFLIES.get().ORBIT_RING_OPACITY,
    };
    FIREFLIES.setKey('ORBIT_RING_COLOR', '#00ff00');
    FIREFLIES.setKey('ORBIT_RING_OPACITY', 0.5);
    try {
      const f = createFireflies(PLACEMENTS, COMMITS);
      f.refresh();
      const ringGroup = f.group.children.find((c) => c.name === 'firefly-orbit-rings');
      expect(ringGroup).toBeDefined();
      const { r, g, b, a } = getRingVertex0RGBA(ringGroup!);
      const expected = new THREE.Color('#00ff00');
      expect(r).toBeCloseTo(expected.r, 4);
      expect(g).toBeCloseTo(expected.g, 4);
      expect(b).toBeCloseTo(expected.b, 4);
      expect(a).toBeCloseTo(0.5, 4);
      f.dispose();
    } finally {
      FIREFLIES.setKey('ORBIT_RING_COLOR', orig.color);
      FIREFLIES.setKey('ORBIT_RING_OPACITY', orig.opacity);
    }
  });

  it('orbit ring is absent when ORBIT_RING_ENABLED is false', () => {
    const orig = FIREFLIES.get().ORBIT_RING_ENABLED;
    FIREFLIES.setKey('ORBIT_RING_ENABLED', false);
    try {
      const f = createFireflies(PLACEMENTS, COMMITS);
      const ringGroup = f.group.children.find((c) => c.name === 'firefly-orbit-rings');
      // The group exists but has no mesh children when disabled.
      expect(ringGroup).toBeDefined();
      expect(ringGroup!.children.length).toBe(0);
      f.dispose();
    } finally {
      FIREFLIES.setKey('ORBIT_RING_ENABLED', orig);
    }
  });

  it('setHoveredCommit writes the hover colour into the vertex buffer', () => {
    const f = createFireflies(PLACEMENTS, COMMITS);
    f.setHoveredCommit(COMMITS[0].sha);
    const ringGroup = f.group.children.find((c) => c.name === 'firefly-orbit-rings');
    const { r, g, b, a } = getRingVertex0RGBA(ringGroup!);
    const expected = new THREE.Color(FIREFLIES.get().ORBIT_RING_HOVER_COLOR);
    expect(r).toBeCloseTo(expected.r, 4);
    expect(g).toBeCloseTo(expected.g, 4);
    expect(b).toBeCloseTo(expected.b, 4);
    expect(a).toBe(1.0);
    f.dispose();
  });

  it('setSelectedCommit beats setHoveredCommit when both target the same ring', () => {
    const f = createFireflies(PLACEMENTS, COMMITS);
    f.setHoveredCommit(COMMITS[0].sha);
    f.setSelectedCommit(COMMITS[0].sha);
    const ringGroup = f.group.children.find((c) => c.name === 'firefly-orbit-rings');
    const { r, g, b, a } = getRingVertex0RGBA(ringGroup!);
    const expected = new THREE.Color(FIREFLIES.get().ORBIT_RING_SELECTED_COLOR);
    expect(r).toBeCloseTo(expected.r, 4);
    expect(g).toBeCloseTo(expected.g, 4);
    expect(b).toBeCloseTo(expected.b, 4);
    expect(a).toBe(1.0);
    f.dispose();
  });

  it('clearing selection restores hover colour when still hovered', () => {
    const f = createFireflies(PLACEMENTS, COMMITS);
    f.setHoveredCommit(COMMITS[0].sha);
    f.setSelectedCommit(COMMITS[0].sha);
    f.setSelectedCommit(null);
    const ringGroup = f.group.children.find((c) => c.name === 'firefly-orbit-rings');
    const { r, g, b, a } = getRingVertex0RGBA(ringGroup!);
    const expected = new THREE.Color(FIREFLIES.get().ORBIT_RING_HOVER_COLOR);
    expect(r).toBeCloseTo(expected.r, 4);
    expect(g).toBeCloseTo(expected.g, 4);
    expect(b).toBeCloseTo(expected.b, 4);
    expect(a).toBe(1.0);
    f.dispose();
  });

  it('clearing hover restores default colour when not selected', () => {
    const f = createFireflies(PLACEMENTS, COMMITS);
    f.setHoveredCommit(COMMITS[0].sha);
    f.setHoveredCommit(null);
    const ringGroup = f.group.children.find((c) => c.name === 'firefly-orbit-rings');
    const { r, g, b, a } = getRingVertex0RGBA(ringGroup!);
    const expected = new THREE.Color(FIREFLIES.get().ORBIT_RING_COLOR);
    expect(r).toBeCloseTo(expected.r, 4);
    expect(g).toBeCloseTo(expected.g, 4);
    expect(b).toBeCloseTo(expected.b, 4);
    expect(a).toBeCloseTo(FIREFLIES.get().ORBIT_RING_OPACITY, 4);
    f.dispose();
  });
});
