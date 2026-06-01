// treeEncoding.test.ts — pure normalization helpers shared by the
// tree renderer: age (commit date → [0,1]), size (file count → [0,1]),
// and commits-per-day (commits sharing the same calendar date, mapped to
// [0,1] by anchoring on the repo's backend-computed busyness thresholds).

import { describe, it, expect } from 'vitest';
import {
  computeAgeRange,
  computeSizeRange,
  computeDailyCounts,
  ageT,
  sizeT,
  dailyCountT,
  dailyCountTByIndex,
  type AgeRange,
  type SizeRange,
} from '@/scene/components/trees/treeEncoding';
import type { CommitEntry } from '@/types';
import { commits as buildCommits } from './_commitFixtures';

const commits: CommitEntry[] = buildCommits(
  { date: '2026-01-01', files: 1 },
  { date: '2026-01-11', files: 5 },
  { date: '2026-01-21', files: 9 }
);

describe('computeAgeRange()', () => {
  it('returns oldest and newest epoch days', () => {
    const r = computeAgeRange(commits);
    expect(r.span).toBeGreaterThan(0);
    expect(r.oldest).toBeLessThan(r.newest);
  });

  it('span = 0 when commits is null', () => {
    expect(computeAgeRange(null).span).toBe(0);
  });

  it('span = 0 when commits is empty', () => {
    expect(computeAgeRange([]).span).toBe(0);
  });

  it('span = 0 when all commits share a date', () => {
    const same = buildCommits({ date: '2026-01-01', files: 1 }, { date: '2026-01-01', files: 5 });
    expect(computeAgeRange(same).span).toBe(0);
  });
});

describe('computeSizeRange()', () => {
  it('returns min and max file counts', () => {
    const r = computeSizeRange(commits);
    expect(r.min).toBe(1);
    expect(r.max).toBe(9);
    expect(r.span).toBe(8);
  });

  it('span = 0 when commits is null', () => {
    expect(computeSizeRange(null).span).toBe(0);
  });

  it('span = 0 when commits is empty', () => {
    expect(computeSizeRange([]).span).toBe(0);
  });

  it('span = 0 when all commits have equal file counts', () => {
    const same = buildCommits({ date: '2026-01-01', files: 4 }, { date: '2026-01-02', files: 4 });
    expect(computeSizeRange(same).span).toBe(0);
  });
});

describe('ageT()', () => {
  it('returns 0 for the oldest commit', () => {
    const range = computeAgeRange(commits);
    expect(ageT(commits[0], range)).toBe(0);
  });

  it('returns 1 for the newest commit', () => {
    const range = computeAgeRange(commits);
    expect(ageT(commits[2], range)).toBe(1);
  });

  it('returns 0.5 for the middle commit (commits are 10 days apart)', () => {
    const range = computeAgeRange(commits);
    expect(ageT(commits[1], range)).toBeCloseTo(0.5, 5);
  });

  it('returns 0.5 when the range has zero span', () => {
    const zero: AgeRange = { oldest: 0, newest: 0, span: 0 };
    expect(
      ageT(
        {
          date: '2026-01-01',
          files: 1,
          sha: 'a'.repeat(40),
          authors: ['Test Author'],
          subject: 'test commit',
        },
        zero
      )
    ).toBe(0.5);
  });

  it('clamps out-of-range dates to [0,1]', () => {
    const range = computeAgeRange(commits);
    expect(
      ageT(
        {
          date: '2025-01-01',
          files: 1,
          sha: 'a'.repeat(40),
          authors: ['Test Author'],
          subject: 'test commit',
        },
        range
      )
    ).toBe(0);
    expect(
      ageT(
        {
          date: '2027-01-01',
          files: 1,
          sha: 'a'.repeat(40),
          authors: ['Test Author'],
          subject: 'test commit',
        },
        range
      )
    ).toBe(1);
  });
});

describe('sizeT()', () => {
  it('returns 0 for the smallest commit', () => {
    const range = computeSizeRange(commits);
    expect(sizeT(commits[0], range)).toBe(0);
  });

  it('returns 1 for the largest commit', () => {
    const range = computeSizeRange(commits);
    expect(sizeT(commits[2], range)).toBe(1);
  });

  it('returns 0.5 when the range has zero span', () => {
    const zero: SizeRange = { min: 0, max: 0, span: 0 };
    expect(
      sizeT(
        {
          date: '2026-01-01',
          files: 1,
          sha: 'a'.repeat(40),
          authors: ['Test Author'],
          subject: 'test commit',
        },
        zero
      )
    ).toBe(0.5);
  });
});

describe('computeDailyCounts()', () => {
  it('counts commits per calendar date in oldest-first order', () => {
    const dc = computeDailyCounts(
      buildCommits(
        { date: '2026-01-01', files: 1 },
        { date: '2026-01-02', files: 1 },
        { date: '2026-01-02', files: 1 },
        { date: '2026-01-02', files: 1 }
      )
    );
    expect(dc.counts).toEqual([1, 3, 3, 3]);
  });

  it('null commits → empty counts', () => {
    expect(computeDailyCounts(null).counts).toEqual([]);
  });

  it('empty commits → empty counts', () => {
    expect(computeDailyCounts([]).counts).toEqual([]);
  });

  it('single-commit history → [1]', () => {
    expect(computeDailyCounts(buildCommits({ date: '2026-01-01', files: 1 })).counts).toEqual([1]);
  });

  it('all-same-day → every count equal', () => {
    const dc = computeDailyCounts(
      buildCommits(
        { date: '2026-01-01', files: 1 },
        { date: '2026-01-01', files: 1 },
        { date: '2026-01-01', files: 1 }
      )
    );
    expect(dc.counts).toEqual([3, 3, 3]);
  });
});

describe('dailyCountT()', () => {
  const thresholds = { avg: 4, busy: 8 };

  it('a solo-commit day (count <= 1) maps to 0', () => {
    expect(dailyCountT(1, thresholds)).toBe(0);
    expect(dailyCountT(0, thresholds)).toBe(0);
  });

  it('the avg threshold maps to the 0.5 midpoint', () => {
    expect(dailyCountT(4, thresholds)).toBeCloseTo(0.5, 5);
  });

  it('the busy threshold (and above) maps to 1', () => {
    expect(dailyCountT(8, thresholds)).toBe(1);
    expect(dailyCountT(50, thresholds)).toBe(1);
  });

  it('interpolates linearly below avg: [1, avg] → [0, 0.5]', () => {
    // count=2.5 is halfway between 1 and 4 → t = 0.25
    expect(dailyCountT(2.5, thresholds)).toBeCloseTo(0.25, 5);
  });

  it('interpolates linearly between avg and busy: (avg, busy] → (0.5, 1]', () => {
    // count=6 is halfway between 4 and 8 → t = 0.75
    expect(dailyCountT(6, thresholds)).toBeCloseTo(0.75, 5);
  });

  it('degenerate thresholds (avg <= 1) stay in [0,1] without NaN', () => {
    expect(dailyCountT(1, { avg: 1, busy: 2 })).toBe(0);
    expect(dailyCountT(2, { avg: 1, busy: 2 })).toBe(1);
  });
});

describe('dailyCountTByIndex()', () => {
  const dc = computeDailyCounts(
    buildCommits(
      { date: '2026-01-01', files: 1 }, // count=1 → t=0
      { date: '2026-01-15', files: 1 }, // count=1 → t=0 (unique date)
      { date: '2026-02-01', files: 1 }, // count=1 (no other Feb 1)
      { date: '2026-03-01', files: 1 }, // count=4 → t=1
      { date: '2026-03-01', files: 1 },
      { date: '2026-03-01', files: 1 },
      { date: '2026-03-01', files: 1 }
    )
  );
  const thresholds = { avg: 2, busy: 4 };

  it('maps single-commit days to 0 and busiest days to 1', () => {
    expect(dailyCountTByIndex(dc, 0, thresholds)).toBe(0);
    expect(dailyCountTByIndex(dc, 1, thresholds)).toBe(0);
    expect(dailyCountTByIndex(dc, 3, thresholds)).toBe(1);
    expect(dailyCountTByIndex(dc, 6, thresholds)).toBe(1);
  });

  it('out-of-range index returns 0.5', () => {
    expect(dailyCountTByIndex(dc, -1, thresholds)).toBe(0.5);
    expect(dailyCountTByIndex(dc, 99, thresholds)).toBe(0.5);
  });
});
