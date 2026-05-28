import { describe, it, expect, beforeEach } from 'vitest';
import { placeFireflies } from '@/scene/components/fireflies/firefliesPlacement.js';
import { FIREFLIES } from '@/config/components/fireflies.js';
import type { CommitEntry } from '@/types';
import type { TreePlacement } from '@/scene/components/trees/treePlacement.js';

const COMMITS: CommitEntry[] = [
  { date: '2026-01-01', files: 1, sha: 'a'.repeat(40), author: 'Alice', subject: 'one' },
  { date: '2026-01-02', files: 2, sha: 'b'.repeat(40), author: 'Bob', subject: 'two' },
];

// TreePlacement has { x, y, seed, commitIndex } — no height/radius fields.
// Those are derived at render/placement time from commits + config.
function placement(commitIndex: number, x: number, z: number): TreePlacement {
  return { x, y: z, seed: 0, commitIndex };
}

describe('placeFireflies', () => {
  beforeEach(() => {
    FIREFLIES.setKey('ORBS_PER_TREE', 3);
  });

  it('returns ORBS_PER_TREE orbs per tree placement', () => {
    const ORBS_PER_TREE = FIREFLIES.get().ORBS_PER_TREE;
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

  it('returns different orbital params for different commit SHAs', () => {
    const a = placeFireflies([placement(0, 0, 0)], COMMITS);
    const altCommits: CommitEntry[] = [{ ...COMMITS[0], sha: 'c'.repeat(40) }, COMMITS[1]];
    const b = placeFireflies([placement(0, 0, 0)], altCommits);
    let anyDifferent = false;
    for (let i = 0; i < a.length; i++) {
      if (
        a[i].orbitStartAngle !== b[i].orbitStartAngle ||
        a[i].orbitRadius !== b[i].orbitRadius ||
        a[i].height !== b[i].height
      ) {
        anyDifferent = true;
        break;
      }
    }
    expect(anyDifferent).toBe(true);
  });

  it('orbs cluster around the tree trunk within a reasonable spatial envelope', () => {
    // TreePlacement has no height/radius. placeFireflies derives them from
    // commits + TREES config. With two commits (files=1 and files=2) the
    // derived canopy radius is near the config midpoint (~24 world units)
    // and height is near TREE_MIN/MAX midpoint (~36 world units).
    // Use loose bounds: orbitRadius ≤ TREE_MAX_WIDTH / 2 * 1.5 and
    // height ≤ TREE_MAX_HEIGHT * 1.4.
    const MAX_RADIUS_BOUND = (64 / 2) * 1.5; // 48
    const MAX_HEIGHT_BOUND = 64 * 1.4; // ~89.6
    const p = placement(0, 100, 200);
    const orbs = placeFireflies([p], COMMITS);
    for (const o of orbs) {
      // Tree center must equal the tree placement coordinates.
      expect(o.treeX).toBe(p.x);
      expect(o.treeZ).toBe(p.y);
      // Orbital radius bounds the XZ spread around the tree center.
      expect(o.orbitRadius).toBeGreaterThanOrEqual(0);
      expect(o.orbitRadius).toBeLessThanOrEqual(MAX_RADIUS_BOUND);
      expect(o.height).toBeGreaterThanOrEqual(0);
      expect(o.height).toBeLessThanOrEqual(MAX_HEIGHT_BOUND);
    }
  });

  it('emits authorColor per-orb from the commit author', async () => {
    const { colorForAuthor } = await import('@/scene/components/fireflies/authorColor.js');
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

  it('assigns an orbitStartAngle in [0, 2π) per orb', () => {
    const orbs = placeFireflies([placement(0, 0, 0)], COMMITS);
    for (const o of orbs) {
      expect(o.orbitStartAngle).toBeGreaterThanOrEqual(0);
      expect(o.orbitStartAngle).toBeLessThan(Math.PI * 2);
    }
  });

  it('assigns an orbitTilt in [-π/6, π/6] per orb', () => {
    const orbs = placeFireflies([placement(0, 0, 0)], COMMITS);
    for (const o of orbs) {
      expect(o.orbitTilt).toBeGreaterThanOrEqual(-Math.PI / 6);
      expect(o.orbitTilt).toBeLessThanOrEqual(Math.PI / 6);
    }
  });

  it('honors ORBS_PER_TREE config value', () => {
    FIREFLIES.setKey('ORBS_PER_TREE', 5);
    try {
      const orbs = placeFireflies([placement(0, 0, 0)], COMMITS);
      expect(orbs.length).toBe(5);
    } finally {
      FIREFLIES.setKey('ORBS_PER_TREE', 3);
    }
  });

  it('assigns a pulse phase in [0, 2π) per orb, independent of bob phase', () => {
    const orbs = placeFireflies([placement(0, 0, 0)], COMMITS);
    for (const o of orbs) {
      expect(o.pulsePhase).toBeGreaterThanOrEqual(0);
      expect(o.pulsePhase).toBeLessThan(Math.PI * 2);
      // Independent stream → unlikely to equal bob phase.
      expect(o.pulsePhase).not.toBe(o.phase);
    }
  });

  it('scale-by-commits assigns larger scale to authors with more commits', () => {
    // Alice has 1 commit (i=0); Bob has 2 commits (i=1, i=2).
    const commits = [
      { date: '2026-01-01', files: 1, sha: 'a'.repeat(40), author: 'Alice', subject: 'a' },
      { date: '2026-01-02', files: 1, sha: 'b'.repeat(40), author: 'Bob', subject: 'b1' },
      { date: '2026-01-03', files: 1, sha: 'c'.repeat(40), author: 'Bob', subject: 'b2' },
    ];
    // Use 1 orb per tree so orbs map 1:1 to placements for easy indexing.
    FIREFLIES.setKey('ORBS_PER_TREE', 1);
    try {
      const orbs = placeFireflies(
        [placement(0, 0, 0), placement(1, 10, 0), placement(2, 20, 0)],
        commits
      );
      // orbs[0] = Alice (1 commit = SCALE_MIN); orbs[1] = Bob (2 commits = SCALE_MAX).
      const aliceOrb = orbs[0];
      const bobOrb = orbs[1];
      expect(bobOrb.scale).toBeGreaterThan(aliceOrb.scale);
    } finally {
      FIREFLIES.setKey('ORBS_PER_TREE', 3);
    }
  });

  it('emits the source commitIndex on each FireflyPlacement', () => {
    FIREFLIES.setKey('ORBS_PER_TREE', 1);
    try {
      const orbs = placeFireflies([placement(0, 0, 0), placement(1, 10, 0)], COMMITS);
      expect(orbs.every((o) => typeof o.commitIndex === 'number')).toBe(true);
      expect(orbs[0].commitIndex).toBe(0);
      expect(orbs[1].commitIndex).toBe(1);
    } finally {
      FIREFLIES.setKey('ORBS_PER_TREE', 3);
    }
  });

  it('all orbs from the same author share the same scale', () => {
    // Use a fixture with 2 commits from the same author.
    const sameAuthor = [
      { date: '2026-01-01', files: 1, sha: 'a'.repeat(40), author: 'Alice', subject: 'a1' },
      { date: '2026-01-02', files: 1, sha: 'b'.repeat(40), author: 'Alice', subject: 'a2' },
    ];
    FIREFLIES.setKey('ORBS_PER_TREE', 1);
    try {
      const orbs = placeFireflies([placement(0, 0, 0), placement(1, 10, 0)], sameAuthor);
      expect(orbs[0].scale).toBe(orbs[1].scale);
    } finally {
      FIREFLIES.setKey('ORBS_PER_TREE', 3);
    }
  });

  it('single-author repo: all orbs scale to SCALE_MAX (degenerate distribution)', () => {
    // When every author has the same commit count (single author or tied
    // distribution), there's no meaningful ranking — render everyone at
    // SCALE_MAX rather than collapsing to SCALE_MIN.
    const soloAuthor = [
      { date: '2026-01-01', files: 1, sha: 'a'.repeat(40), author: 'Solo', subject: 'a' },
      { date: '2026-01-02', files: 1, sha: 'b'.repeat(40), author: 'Solo', subject: 'b' },
    ];
    FIREFLIES.setKey('ORBS_PER_TREE', 1);
    try {
      const orbs = placeFireflies([placement(0, 0, 0), placement(1, 10, 0)], soloAuthor);
      const scaleMax = FIREFLIES.get().SCALE_MAX;
      expect(orbs[0].scale).toBe(scaleMax);
      expect(orbs[1].scale).toBe(scaleMax);
    } finally {
      FIREFLIES.setKey('ORBS_PER_TREE', 3);
    }
  });
});
