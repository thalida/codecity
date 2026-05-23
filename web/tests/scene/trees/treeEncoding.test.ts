// treeEncoding.test.ts — pure normalization helpers shared by the
// tree renderer: age (commit date → [0,1]) and size (file count → [0,1]).

import { describe, it, expect } from 'vitest';
import {
  computeAgeRange,
  computeSizeRange,
  ageT,
  sizeT,
  type AgeRange,
  type SizeRange,
} from '@/scene/trees/treeEncoding.js';
import type { CommitEntry } from '@/types';

const commits: CommitEntry[] = [
  { date: '2026-01-01', files: 1 },
  { date: '2026-01-11', files: 5 },
  { date: '2026-01-21', files: 9 },
];

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
    const same: CommitEntry[] = [
      { date: '2026-01-01', files: 1 },
      { date: '2026-01-01', files: 5 },
    ];
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
    const same: CommitEntry[] = [
      { date: '2026-01-01', files: 4 },
      { date: '2026-01-02', files: 4 },
    ];
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
    expect(ageT({ date: '2026-01-01', files: 1 }, zero)).toBe(0.5);
  });

  it('clamps out-of-range dates to [0,1]', () => {
    const range = computeAgeRange(commits);
    expect(ageT({ date: '2025-01-01', files: 1 }, range)).toBe(0);
    expect(ageT({ date: '2027-01-01', files: 1 }, range)).toBe(1);
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
    expect(sizeT({ date: '2026-01-01', files: 1 }, zero)).toBe(0.5);
  });
});
