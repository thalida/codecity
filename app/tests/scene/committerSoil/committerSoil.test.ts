import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createCommitterSoil } from '@/scene/components/committerSoil/committerSoil.js';
import { COMMITTER_SOIL } from '@/config/components/committerSoil.js';
import type { CommitEntry } from '@/types';
import type { TreePlacement } from '@/scene/components/trees/treePlacement.js';

const COMMITS: CommitEntry[] = [
  { date: '2026-01-01', files: 1, sha: 'a'.repeat(40), author: 'Alice', subject: 'a' },
];

const PLACEMENTS: TreePlacement[] = [
  { x: 0, y: 0, seed: 0, commitIndex: 0 } as TreePlacement,
];

describe('createCommitterSoil', () => {
  it('returns a group with one InstancedMesh when enabled and commits are non-empty', () => {
    const s = createCommitterSoil(PLACEMENTS, COMMITS);
    expect(s.group).toBeInstanceOf(THREE.Group);
    expect(s.group.children.filter((c) => c instanceof THREE.InstancedMesh).length).toBe(1);
    s.dispose();
  });

  it('returns an empty group when commits is null', () => {
    const s = createCommitterSoil(PLACEMENTS, null);
    expect(s.group.children.length).toBe(0);
    s.dispose();
  });

  it('returns an empty group when placements is empty', () => {
    const s = createCommitterSoil([], COMMITS);
    expect(s.group.children.length).toBe(0);
    s.dispose();
  });

  it('dispose() empties the group', () => {
    const s = createCommitterSoil(PLACEMENTS, COMMITS);
    s.dispose();
    expect(s.group.children.length).toBe(0);
  });

  it('returns an empty group when COMMITTER_SOIL_ENABLED is false', () => {
    const orig = COMMITTER_SOIL.get().COMMITTER_SOIL_ENABLED;
    COMMITTER_SOIL.setKey('COMMITTER_SOIL_ENABLED', false);
    try {
      const s = createCommitterSoil(PLACEMENTS, COMMITS);
      expect(s.group.children.length).toBe(0);
      s.dispose();
    } finally {
      COMMITTER_SOIL.setKey('COMMITTER_SOIL_ENABLED', orig);
    }
  });
});
