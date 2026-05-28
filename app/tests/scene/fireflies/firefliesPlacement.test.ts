import { describe, it, expect } from 'vitest';
import { placeFireflies } from '@/scene/components/fireflies/firefliesPlacement.js';
import type { CommitEntry } from '@/types';
import type { TreePlacement } from '@/scene/components/trees/treePlacement.js';

const ORBS_PER_TREE = 3;

const COMMITS: CommitEntry[] = [
  { date: '2026-01-01', files: 1, sha: 'a'.repeat(40), author: 'Alice', subject: 'one' },
  { date: '2026-01-02', files: 2, sha: 'b'.repeat(40), author: 'Bob',   subject: 'two' },
];

// TreePlacement has { x, y, seed, commitIndex } — no height/radius fields.
// Those are derived at render/placement time from commits + config.
function placement(commitIndex: number, x: number, z: number): TreePlacement {
  return { x, y: z, seed: 0, commitIndex };
}

describe('placeFireflies', () => {
  it('returns ORBS_PER_TREE orbs per tree placement', () => {
    const placements = [placement(0, 10, 5), placement(1, -3, 8)];
    const orbs = placeFireflies(placements, COMMITS);
    expect(orbs.length).toBe(placements.length * ORBS_PER_TREE);
  });

  it('is deterministic for the same input', () => {
    const placements = [placement(0, 10, 5)];
    const a = placeFireflies(placements, COMMITS);
    const b = placeFireflies(placements, COMMITS);
    expect(a).toEqual(b);
  });

  it('returns different offsets for different commit SHAs', () => {
    const a = placeFireflies([placement(0, 0, 0)], COMMITS);
    const altCommits: CommitEntry[] = [
      { ...COMMITS[0], sha: 'c'.repeat(40) },
      COMMITS[1],
    ];
    const b = placeFireflies([placement(0, 0, 0)], altCommits);
    let anyDifferent = false;
    for (let i = 0; i < a.length; i++) {
      if (a[i].x !== b[i].x || a[i].height !== b[i].height || a[i].z !== b[i].z) {
        anyDifferent = true; break;
      }
    }
    expect(anyDifferent).toBe(true);
  });

  it('orbs cluster around the tree trunk within a reasonable spatial envelope', () => {
    // TreePlacement has no height/radius. placeFireflies derives them from
    // commits + TREES config. With two commits (files=1 and files=2) the
    // derived canopy radius is near the config midpoint (~24 world units)
    // and height is near TREE_MIN/MAX midpoint (~36 world units).
    // Use loose bounds: radius ≤ TREE_MAX_WIDTH / 2 * 1.5 and
    // height ≤ TREE_MAX_HEIGHT * 1.4.
    const MAX_RADIUS_BOUND = (64 / 2) * 1.5; // 48
    const MAX_HEIGHT_BOUND = 64 * 1.4;        // ~89.6
    const p = placement(0, 100, 200);
    const orbs = placeFireflies([p], COMMITS);
    for (const o of orbs) {
      const dx = o.x - p.x;
      const dz = o.z - p.y;
      const dist = Math.sqrt(dx * dx + dz * dz);
      expect(dist).toBeGreaterThanOrEqual(0);
      expect(dist).toBeLessThanOrEqual(MAX_RADIUS_BOUND);
      expect(o.height).toBeGreaterThanOrEqual(0);
      expect(o.height).toBeLessThanOrEqual(MAX_HEIGHT_BOUND);
    }
  });

  it('emits authorColor per-orb from the commit author', async () => {
    const { colorForAuthor } = await import(
      '@/scene/components/fireflies/authorColor.js'
    );
    const orbs = placeFireflies([placement(0, 0, 0)], COMMITS);
    const expected = colorForAuthor(COMMITS[0].author).hex;
    for (const o of orbs) {
      expect(o.colorHex).toBe(expected);
    }
  });

  it('skips placements with invalid commitIndex', () => {
    const orbs = placeFireflies([placement(99, 0, 0)], COMMITS);
    expect(orbs.length).toBe(0);
  });

  it('assigns a phase offset in [0, 2π) per orb', () => {
    const orbs = placeFireflies([placement(0, 0, 0)], COMMITS);
    for (const o of orbs) {
      expect(o.phase).toBeGreaterThanOrEqual(0);
      expect(o.phase).toBeLessThan(Math.PI * 2);
    }
  });
});
