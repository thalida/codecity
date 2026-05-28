import { describe, it, expect } from 'vitest';
import { placeSoil } from '@/scene/components/committerSoil/soilPlacement.js';
import { colorForAuthor } from '@/scene/components/fireflies/authorColor.js';
import type { CommitEntry } from '@/types';
import type { TreePlacement } from '@/scene/components/trees/treePlacement.js';

const COMMITS: CommitEntry[] = [
  { date: '2026-01-01', files: 1, sha: 'a'.repeat(40), author: 'Alice', subject: 'one' },
  { date: '2026-01-02', files: 2, sha: 'b'.repeat(40), author: 'Bob',   subject: 'two' },
];

function placement(commitIndex: number, x: number, z: number): TreePlacement {
  return { x, y: z, seed: 0, commitIndex } as TreePlacement;
}

describe('placeSoil', () => {
  it('returns one ring per tree placement', () => {
    const rings = placeSoil(
      [placement(0, 10, 5), placement(1, -3, 8)],
      COMMITS,
    );
    expect(rings.length).toBe(2);
  });

  it('returns [] when commits is null or empty', () => {
    expect(placeSoil([placement(0, 0, 0)], null)).toEqual([]);
    expect(placeSoil([placement(0, 0, 0)], [])).toEqual([]);
  });

  it('skips placements with invalid commitIndex', () => {
    expect(placeSoil([placement(99, 0, 0)], COMMITS)).toEqual([]);
  });

  it('uses tree x/y as the ring center', () => {
    const rings = placeSoil([placement(0, 7, 3)], COMMITS);
    expect(rings[0].treeX).toBe(7);
    expect(rings[0].treeZ).toBe(3);
  });

  it('color matches colorForAuthor for the commit author', () => {
    const rings = placeSoil([placement(0, 0, 0)], COMMITS);
    expect(rings[0].colorHex).toBe(colorForAuthor('Alice').hex);
  });
});
