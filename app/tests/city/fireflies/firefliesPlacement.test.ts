import { describe, it, expect } from 'vitest';
import { placeFireflies } from '@/city/components/fireflies/firefliesPlacement';
import { FIREFLIES } from '@/state/stores/settings/fireflies';
import type { CommitEntry } from '@/types';
import type { TreePlacement } from '@/city/components/trees/treePlacement';
import { commitStats } from '../../_helpers/statsFixtures';

const COMMITS: CommitEntry[] = [
  {
    date: '2026-01-01',
    files: 1,
    sha: 'a'.repeat(40),
    authors: ['Alice'],
    subject: 'one',
    same_day_total: 1,
  },
  {
    date: '2026-01-02',
    files: 2,
    sha: 'b'.repeat(40),
    authors: ['Bob'],
    subject: 'two',
    same_day_total: 1,
  },
];

// TreePlacement has { x, y, seed, commitIndex } — no height/radius fields.
// Those are derived at render/placement time from commits + config.
function placement(commitIndex: number, x: number, z: number): TreePlacement {
  return { x, y: z, seed: 0, commitIndex };
}

describe('placeFireflies', () => {
  it('single-author commits emit exactly 1 orb per tree (regression)', () => {
    const placements = [placement(0, 10, 5), placement(1, -3, 8)];
    const orbs = placeFireflies(placements, COMMITS, commitStats(COMMITS));
    expect(orbs.length).toBe(placements.length);
  });

  it('is deterministic for the same input', () => {
    const placements = [placement(0, 10, 5)];
    const a = placeFireflies(placements, COMMITS, commitStats(COMMITS));
    const b = placeFireflies(placements, COMMITS, commitStats(COMMITS));
    expect(a).toEqual(b);
  });

  it('returns different orbital params for different commit SHAs', () => {
    const a = placeFireflies([placement(0, 0, 0)], COMMITS, commitStats(COMMITS));
    const altCommits: CommitEntry[] = [{ ...COMMITS[0], sha: 'c'.repeat(40) }, COMMITS[1]];
    const b = placeFireflies([placement(0, 0, 0)], altCommits, commitStats(altCommits));
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
    // and height is near TREE_MIN/MAX midpoint (~52 world units with new 96 max).
    // Use loose bounds: orbitRadius ≤ MAX_WIDTH / 2 * 1.5 and
    // height ≤ MAX_HEIGHT * 1.4.
    const MAX_RADIUS_BOUND = (64 / 2) * 1.5; // 48
    const MAX_HEIGHT_BOUND = 96 * 1.4; // ~134.4
    const p = placement(0, 100, 200);
    const orbs = placeFireflies([p], COMMITS, commitStats(COMMITS));
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
    const { colorForAuthor } = await import('@/city/components/fireflies/authorColor.js');
    const stats = commitStats(COMMITS);
    const orbs = placeFireflies([placement(0, 0, 0)], COMMITS, stats);
    const hue = stats.authors.find((a) => a.name === COMMITS[0].authors[0])!.hue;
    const expected = colorForAuthor(hue).rgb;
    for (const o of orbs) {
      expect(o.rgb).toEqual(expected);
    }
  });

  it('skips placements with invalid commitIndex', () => {
    const orbs = placeFireflies([placement(99, 0, 0)], COMMITS, commitStats(COMMITS));
    expect(orbs.length).toBe(0);
  });

  it('assigns a phase offset in [0, 2π) per orb', () => {
    const orbs = placeFireflies([placement(0, 0, 0)], COMMITS, commitStats(COMMITS));
    for (const o of orbs) {
      expect(o.phase).toBeGreaterThanOrEqual(0);
      expect(o.phase).toBeLessThan(Math.PI * 2);
    }
  });

  it('assigns an orbitStartAngle in [0, 2π) per orb', () => {
    const orbs = placeFireflies([placement(0, 0, 0)], COMMITS, commitStats(COMMITS));
    for (const o of orbs) {
      expect(o.orbitStartAngle).toBeGreaterThanOrEqual(0);
      expect(o.orbitStartAngle).toBeLessThan(Math.PI * 2);
    }
  });

  it('assigns an orbitTilt in [-π/6, π/6] per orb', () => {
    const orbs = placeFireflies([placement(0, 0, 0)], COMMITS, commitStats(COMMITS));
    for (const o of orbs) {
      expect(o.orbitTilt).toBeGreaterThanOrEqual(-Math.PI / 6);
      expect(o.orbitTilt).toBeLessThanOrEqual(Math.PI / 6);
    }
  });

  it('assigns a pulse phase in [0, 2π) per orb, independent of bob phase', () => {
    const orbs = placeFireflies([placement(0, 0, 0)], COMMITS, commitStats(COMMITS));
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
      {
        date: '2026-01-01',
        files: 1,
        sha: 'a'.repeat(40),
        authors: ['Alice'],
        subject: 'a',
        same_day_total: 1,
      },
      {
        date: '2026-01-02',
        files: 1,
        sha: 'b'.repeat(40),
        authors: ['Bob'],
        subject: 'b1',
        same_day_total: 1,
      },
      {
        date: '2026-01-03',
        files: 1,
        sha: 'c'.repeat(40),
        authors: ['Bob'],
        subject: 'b2',
        same_day_total: 1,
      },
    ];
    // 1 orb per tree: orbs map 1:1 to placements for easy indexing.
    const orbs = placeFireflies(
      [placement(0, 0, 0), placement(1, 10, 0), placement(2, 20, 0)],
      commits,
      commitStats(commits)
    );
    // orbs[0] = Alice (1 commit = SCALE_MIN); orbs[1] = Bob (2 commits = SCALE_MAX).
    const aliceOrb = orbs[0];
    const bobOrb = orbs[1];
    expect(bobOrb.scale).toBeGreaterThan(aliceOrb.scale);
  });

  it('emits the source commitIndex on each FireflyPlacement', () => {
    const orbs = placeFireflies(
      [placement(0, 0, 0), placement(1, 10, 0)],
      COMMITS,
      commitStats(COMMITS)
    );
    expect(orbs.every((o) => typeof o.commitIndex === 'number')).toBe(true);
    expect(orbs[0].commitIndex).toBe(0);
    expect(orbs[1].commitIndex).toBe(1);
  });

  it('all orbs from the same author share the same scale', () => {
    // Use a fixture with 2 commits from the same author.
    const sameAuthor = [
      {
        date: '2026-01-01',
        files: 1,
        sha: 'a'.repeat(40),
        authors: ['Alice'],
        subject: 'a1',
        same_day_total: 1,
      },
      {
        date: '2026-01-02',
        files: 1,
        sha: 'b'.repeat(40),
        authors: ['Alice'],
        subject: 'a2',
        same_day_total: 1,
      },
    ];
    const orbs = placeFireflies(
      [placement(0, 0, 0), placement(1, 10, 0)],
      sameAuthor,
      commitStats(sameAuthor)
    );
    expect(orbs[0].scale).toBe(orbs[1].scale);
  });

  it('single-author repo: all orbs scale to SCALE_MAX (degenerate distribution)', () => {
    // When every author has the same commit count (single author or tied
    // distribution), there's no meaningful ranking — render everyone at
    // SCALE_MAX rather than collapsing to SCALE_MIN.
    const soloAuthor = [
      {
        date: '2026-01-01',
        files: 1,
        sha: 'a'.repeat(40),
        authors: ['Solo'],
        subject: 'a',
        same_day_total: 1,
      },
      {
        date: '2026-01-02',
        files: 1,
        sha: 'b'.repeat(40),
        authors: ['Solo'],
        subject: 'b',
        same_day_total: 1,
      },
    ];
    const orbs = placeFireflies(
      [placement(0, 0, 0), placement(1, 10, 0)],
      soloAuthor,
      commitStats(soloAuthor)
    );
    const scaleMax = FIREFLIES.value.SCALE_MAX;
    expect(orbs[0].scale).toBe(scaleMax);
    expect(orbs[1].scale).toBe(scaleMax);
  });

  it('emits one orb per distinct author on a multi-author commit', () => {
    const multiAuthor: CommitEntry[] = [
      {
        date: '2026-01-01',
        files: 1,
        sha: 'a'.repeat(40),
        authors: ['Alice', 'Bob', 'Carol'],
        subject: 'team work',
        same_day_total: 1,
      },
    ];
    const orbs = placeFireflies([placement(0, 0, 0)], multiAuthor, commitStats(multiAuthor));
    expect(orbs.length).toBe(3);
  });

  it("colors each per-author orb with that author's color", async () => {
    const { colorForAuthor } = await import('@/city/components/fireflies/authorColor.js');
    const multiAuthor: CommitEntry[] = [
      {
        date: '2026-01-01',
        files: 1,
        sha: 'a'.repeat(40),
        authors: ['Alice', 'Bob', 'Carol'],
        subject: 'team work',
        same_day_total: 1,
      },
    ];
    const stats = commitStats(multiAuthor);
    const orbs = placeFireflies([placement(0, 0, 0)], multiAuthor, stats);
    const hueOf = (n: string) => stats.authors.find((a) => a.name === n)!.hue;
    expect(orbs[0].rgb).toEqual(colorForAuthor(hueOf('Alice')).rgb);
    expect(orbs[1].rgb).toEqual(colorForAuthor(hueOf('Bob')).rgb);
    expect(orbs[2].rgb).toEqual(colorForAuthor(hueOf('Carol')).rgb);
  });

  it('per-author orbs share orbit center but have distinct angles', () => {
    const multiAuthor: CommitEntry[] = [
      {
        date: '2026-01-01',
        files: 1,
        sha: 'a'.repeat(40),
        authors: ['Alice', 'Bob', 'Carol'],
        subject: 'team work',
        same_day_total: 1,
      },
    ];
    const orbs = placeFireflies([placement(0, 100, 200)], multiAuthor, commitStats(multiAuthor));
    // Same orbit center (tree position).
    expect(orbs[0].treeX).toBe(100);
    expect(orbs[1].treeX).toBe(100);
    expect(orbs[2].treeX).toBe(100);
    expect(orbs[0].treeZ).toBe(200);
    // Distinct seeds → distinct orbit start angles (probability of any
    // two coinciding under Mulberry32 is ~2^-32; effectively zero).
    expect(orbs[0].orbitStartAngle).not.toBe(orbs[1].orbitStartAngle);
    expect(orbs[1].orbitStartAngle).not.toBe(orbs[2].orbitStartAngle);
    expect(orbs[0].orbitStartAngle).not.toBe(orbs[2].orbitStartAngle);
  });

  it("counts co-authorship toward each author's tally", () => {
    // Commit 0 is co-authored by Alice and Bob; commit 1 is Bob solo.
    // Tally: Alice=1, Bob=2. After scale lerp, Bob's orbs should scale
    // larger than Alice's.
    const commits: CommitEntry[] = [
      {
        date: '2026-01-01',
        files: 1,
        sha: 'a'.repeat(40),
        authors: ['Alice', 'Bob'],
        subject: 'pair',
        same_day_total: 1,
      },
      {
        date: '2026-01-02',
        files: 1,
        sha: 'b'.repeat(40),
        authors: ['Bob'],
        subject: 'solo',
        same_day_total: 1,
      },
    ];
    const orbs = placeFireflies(
      [placement(0, 0, 0), placement(1, 10, 0)],
      commits,
      commitStats(commits)
    );
    // orbs[0] = Alice from commit 0, orbs[1] = Bob from commit 0,
    // orbs[2] = Bob from commit 1.
    const aliceOrb = orbs[0];
    const bobOrbs = [orbs[1], orbs[2]];
    expect(bobOrbs[0].scale).toBeGreaterThan(aliceOrb.scale);
    expect(bobOrbs[0].scale).toBe(bobOrbs[1].scale); // same author, same scale
  });
});
