// treeEncoding.test.ts — pure normalization helpers shared by the
// tree renderer: age (commit date → [0,1]), size (file count → [0,1]),
// and commits-per-day (commits sharing the same calendar date,
// log-normalized → [0,1]).

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
  type DailyCountRange,
} from '@/scene/components/trees/treeEncoding.js';
import type { CommitEntry } from '@/types';
import { commits as buildCommits } from './_commitFixtures.js';

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
          author: 'Test Author',
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
          author: 'Test Author',
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
          author: 'Test Author',
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
          author: 'Test Author',
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
    expect(dc.range.min).toBe(1);
    expect(dc.range.max).toBe(3);
    expect(dc.range.span).toBe(2);
  });

  it('null commits collapse the range', () => {
    const dc = computeDailyCounts(null);
    expect(dc.counts).toEqual([]);
    expect(dc.range.span).toBe(0);
  });

  it('empty commits collapse the range', () => {
    const dc = computeDailyCounts([]);
    expect(dc.counts).toEqual([]);
    expect(dc.range.span).toBe(0);
  });

  it('single-commit history collapses the range (min=max=1)', () => {
    const dc = computeDailyCounts(buildCommits({ date: '2026-01-01', files: 1 }));
    expect(dc.counts).toEqual([1]);
    expect(dc.range.span).toBe(0);
  });

  it('all-same-day collapses the range (every count equal)', () => {
    const dc = computeDailyCounts(
      buildCommits(
        { date: '2026-01-01', files: 1 },
        { date: '2026-01-01', files: 1 },
        { date: '2026-01-01', files: 1 }
      )
    );
    expect(dc.counts).toEqual([3, 3, 3]);
    expect(dc.range.min).toBe(3);
    expect(dc.range.max).toBe(3);
    expect(dc.range.span).toBe(0);
  });
});

describe('dailyCountT()', () => {
  it('low counts return ~0, high counts return ~1', () => {
    const range: DailyCountRange = { min: 1, max: 100, span: 99 };
    expect(dailyCountT(1, range)).toBeCloseTo(0, 5);
    expect(dailyCountT(100, range)).toBeCloseTo(1, 5);
  });

  it('log-normalizes so middle counts land in the middle of [0,1]', () => {
    const range: DailyCountRange = { min: 1, max: 100, span: 99 };
    expect(dailyCountT(13, range)).toBeCloseTo(0.5, 1);
  });

  it('returns 0.5 when the range has zero span', () => {
    expect(dailyCountT(5, { min: 5, max: 5, span: 0 })).toBe(0.5);
  });

  it('clamps out-of-range counts to [0,1]', () => {
    const range: DailyCountRange = { min: 2, max: 10, span: 8 };
    expect(dailyCountT(1, range)).toBe(0);
    expect(dailyCountT(99, range)).toBe(1);
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

  it('maps single-commit days to ~0 and busiest days to ~1', () => {
    expect(dailyCountTByIndex(dc, 0)).toBeCloseTo(0, 5);
    expect(dailyCountTByIndex(dc, 1)).toBeCloseTo(0, 5);
    expect(dailyCountTByIndex(dc, 3)).toBeCloseTo(1, 5);
    expect(dailyCountTByIndex(dc, 6)).toBeCloseTo(1, 5);
  });

  it('out-of-range index returns 0.5', () => {
    expect(dailyCountTByIndex(dc, -1)).toBe(0.5);
    expect(dailyCountTByIndex(dc, 99)).toBe(0.5);
  });
});
