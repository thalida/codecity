import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createFireflies } from '@/scene/components/fireflies/fireflies.js';
import { FIREFLIES } from '@/config/components/fireflies.js';
import type { CommitEntry } from '@/types';
import type { TreePlacement } from '@/scene/components/trees/treePlacement.js';

const COMMITS: CommitEntry[] = [
  { date: '2026-01-01', files: 1, sha: 'a'.repeat(40), author: 'Alice', subject: 'a' },
];

const PLACEMENTS: TreePlacement[] = [
  { x: 0, y: 0, commitIndex: 0, seed: 0 } as TreePlacement,
];

describe('createFireflies', () => {
  it('returns a group containing one InstancedMesh when commits is non-empty', () => {
    const f = createFireflies(PLACEMENTS, COMMITS);
    expect(f.group).toBeInstanceOf(THREE.Group);
    const meshes = f.group.children.filter((c) => c instanceof THREE.InstancedMesh);
    expect(meshes.length).toBe(1);
    f.dispose();
  });

  it('returns an empty group when commits is null', () => {
    const f = createFireflies(PLACEMENTS, null);
    expect(f.group.children.length).toBe(0);
    f.dispose();
  });

  it('returns an empty group when placements is empty', () => {
    const f = createFireflies([], COMMITS);
    expect(f.group.children.length).toBe(0);
    f.dispose();
  });

  it('dispose() empties the group', () => {
    const f = createFireflies(PLACEMENTS, COMMITS);
    f.dispose();
    expect(f.group.children.length).toBe(0);
  });

  it('setTime(t) is a no-op when the group is empty (no instances)', () => {
    const f = createFireflies([], COMMITS);
    expect(() => f.setTime(1.0)).not.toThrow();
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
});
