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

describe('createFireflies', () => {
  it('returns a group containing one InstancedMesh (orbs) and one LineLoop (rings) when commits is non-empty', () => {
    const f = createFireflies(PLACEMENTS, COMMITS);
    expect(f.group).toBeInstanceOf(THREE.Group);
    // The parent group has two child Groups (rings + renderer).
    // Rings group contains one LineLoop; renderer group contains one InstancedMesh.
    const allDescendants = f.group.children.flatMap((c) => c.children);
    const instancedMeshes = allDescendants.filter((c) => c instanceof THREE.InstancedMesh);
    const lineLoops = allDescendants.filter((c) => c instanceof THREE.LineLoop);
    expect(instancedMeshes.length).toBe(1);
    expect(lineLoops.length).toBe(1);
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

  it('dispose() removes all descendant InstancedMeshes and LineLoops', () => {
    const f = createFireflies(PLACEMENTS, COMMITS);
    f.dispose();
    const allDescendants = f.group.children.flatMap((c) => c.children);
    const instancedMeshes = allDescendants.filter((c) => c instanceof THREE.InstancedMesh);
    const lineLoops = allDescendants.filter((c) => c instanceof THREE.LineLoop);
    expect(instancedMeshes.length).toBe(0);
    expect(lineLoops.length).toBe(0);
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

  it('refresh() updates the ring material color + opacity', () => {
    const orig = {
      color: FIREFLIES.get().ORBIT_RING_COLOR,
      opacity: FIREFLIES.get().ORBIT_RING_OPACITY,
    };
    FIREFLIES.setKey('ORBIT_RING_COLOR', '#00ff00');
    FIREFLIES.setKey('ORBIT_RING_OPACITY', 0.5);
    try {
      const f = createFireflies(PLACEMENTS, COMMITS);
      f.refresh();
      // Find the orbit-ring group inside the parent group.
      const ringGroup = f.group.children.find((c) => c.name === 'firefly-orbit-rings');
      expect(ringGroup).toBeDefined();
      const ringMesh = ringGroup!.children[0] as THREE.LineLoop;
      const mat = ringMesh.material as THREE.LineBasicMaterial;
      expect(mat.color.getHexString()).toBe('00ff00');
      expect(mat.opacity).toBe(0.5);
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
});
