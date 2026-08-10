// treeEncoding.test.ts — pure normalization helpers shared by the
// tree renderer: age (commit date → [0,1]), size (file count → [0,1]),
// and commits-per-day (commits sharing the same calendar date, mapped to
// [0,1] by anchoring on the repo's backend-computed busyness thresholds).

import { describe, it, expect } from 'vitest';
import {
  computeAgeRange,
  computeSizeRange,
  ageT,
  sizeT,
  dailyCountT,
  dailyCountTByIndex,
  treeHeight,
  treeRadius,
  type AgeRange,
  type SizeRange,
} from '@/city/components/trees/treeEncoding';
import type { TreesConfig } from '@/state/stores/settings/trees';
import type { CommitEntry } from '@/types';
import { commits as buildCommits } from '../../../_helpers/commits';
import { commitStats } from '../../../_helpers/statsFixtures';

const commits: CommitEntry[] = buildCommits(
  { date: '2026-01-01', files: 1 },
  { date: '2026-01-11', files: 5 },
  { date: '2026-01-21', files: 9 }
);

describe('computeAgeRange()', () => {
  it('returns oldest and newest epoch days', () => {
    const r = computeAgeRange(commitStats(commits));
    expect(r.span).toBeGreaterThan(0);
    expect(r.oldest).toBeLessThan(r.newest);
  });

  it('span = 0 when stats is null', () => {
    expect(computeAgeRange(null).span).toBe(0);
  });

  it('span = 0 when there are no commits', () => {
    expect(computeAgeRange(commitStats([])).span).toBe(0);
  });

  it('span = 0 when all commits share a date', () => {
    const same = buildCommits({ date: '2026-01-01', files: 1 }, { date: '2026-01-01', files: 5 });
    expect(computeAgeRange(commitStats(same)).span).toBe(0);
  });
});

describe('computeAgeRange() daysIdle', () => {
  // daysIdle = max(0, scanned_at − newest commit), in whole days. It's the raw,
  // settings-independent fact; treeHeight turns it into a staleness lift using
  // the TREES horizon/cap. Newest commit in this fixture is 2026-01-21.
  it('is 0 when scanned_at is omitted (feature off / backward compatible)', () => {
    expect(computeAgeRange(commitStats(commits)).daysIdle).toBe(0);
  });

  it('is 0 when scanned on the newest commit day (fresh repo)', () => {
    expect(computeAgeRange(commitStats(commits), '2026-01-21').daysIdle).toBe(0);
  });

  it('clamps to 0 when scanned before the newest commit', () => {
    expect(computeAgeRange(commitStats(commits), '2025-06-01').daysIdle).toBe(0);
  });

  it('counts whole days between the newest commit and the scan', () => {
    // 2026-01-21 → 2027-01-21 is exactly 365 days.
    expect(computeAgeRange(commitStats(commits), '2027-01-21').daysIdle).toBe(365);
  });

  it('is 0 when there are no commits, regardless of scanned_at', () => {
    expect(computeAgeRange(commitStats([]), '2036-01-21').daysIdle).toBe(0);
    expect(computeAgeRange(null, '2036-01-21').daysIdle).toBe(0);
  });

  it('accepts an ISO datetime scanned_at (day precision)', () => {
    // Same 365-day gap, but scanned_at as a full ISO timestamp.
    expect(computeAgeRange(commitStats(commits), '2027-01-21T13:45:00Z').daysIdle).toBe(365);
  });
});

describe('computeSizeRange()', () => {
  it('returns min and max file counts', () => {
    const r = computeSizeRange(commitStats(commits));
    expect(r.min).toBe(1);
    expect(r.max).toBe(9);
    expect(r.span).toBe(8);
  });

  it('span = 0 when stats is null', () => {
    expect(computeSizeRange(null).span).toBe(0);
  });

  it('span = 0 when there are no commits', () => {
    expect(computeSizeRange(commitStats([])).span).toBe(0);
  });

  it('span = 0 when all commits have equal file counts', () => {
    const same = buildCommits({ date: '2026-01-01', files: 4 }, { date: '2026-01-02', files: 4 });
    expect(computeSizeRange(commitStats(same)).span).toBe(0);
  });
});

describe('ageT()', () => {
  it('returns 0 for the oldest commit', () => {
    const range = computeAgeRange(commitStats(commits));
    expect(ageT(commits[0], range)).toBe(0);
  });

  it('returns 1 for the newest commit', () => {
    const range = computeAgeRange(commitStats(commits));
    expect(ageT(commits[2], range)).toBe(1);
  });

  it('returns 0.5 for the middle commit (commits are 10 days apart)', () => {
    const range = computeAgeRange(commitStats(commits));
    expect(ageT(commits[1], range)).toBeCloseTo(0.5, 5);
  });

  it('returns 0.5 when the range has zero span', () => {
    const zero: AgeRange = { oldest: 0, newest: 0, span: 0, daysIdle: 0 };
    expect(ageT(buildCommits({ date: '2026-01-01', files: 1 })[0], zero)).toBe(0.5);
  });

  it('clamps out-of-range dates to [0,1]', () => {
    const range = computeAgeRange(commitStats(commits));
    expect(ageT(buildCommits({ date: '2025-01-01', files: 1 })[0], range)).toBe(0);
    expect(ageT(buildCommits({ date: '2027-01-01', files: 1 })[0], range)).toBe(1);
  });
});

describe('sizeT()', () => {
  it('returns 0 for the smallest commit', () => {
    const range = computeSizeRange(commitStats(commits));
    expect(sizeT(commits[0], range)).toBe(0);
  });

  it('returns 1 for the largest commit', () => {
    const range = computeSizeRange(commitStats(commits));
    expect(sizeT(commits[2], range)).toBe(1);
  });

  it('returns 0.5 when the range has zero span', () => {
    const zero: SizeRange = { min: 0, max: 0, span: 0 };
    expect(sizeT(buildCommits({ date: '2026-01-01', files: 1 })[0], zero)).toBe(0.5);
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
  // The commits helper bakes same_day_total from the date grouping (as the
  // backend), so these dates produce same_day_total = {1,1,1,4,4,4,4}.
  const cs = buildCommits(
    { date: '2026-01-01', files: 1 }, // same_day_total=1 → t=0
    { date: '2026-01-15', files: 1 }, // 1 → t=0 (unique date)
    { date: '2026-02-01', files: 1 }, // 1 (no other Feb 1)
    { date: '2026-03-01', files: 1 }, // 4 → t=1
    { date: '2026-03-01', files: 1 },
    { date: '2026-03-01', files: 1 },
    { date: '2026-03-01', files: 1 }
  );
  const thresholds = { avg: 2, busy: 4 };

  it('maps single-commit days to 0 and busiest days to 1', () => {
    expect(dailyCountTByIndex(cs, 0, thresholds)).toBe(0);
    expect(dailyCountTByIndex(cs, 1, thresholds)).toBe(0);
    expect(dailyCountTByIndex(cs, 3, thresholds)).toBe(1);
    expect(dailyCountTByIndex(cs, 6, thresholds)).toBe(1);
  });

  it('out-of-range index returns 0.5', () => {
    expect(dailyCountTByIndex(cs, -1, thresholds)).toBe(0.5);
    expect(dailyCountTByIndex(cs, 99, thresholds)).toBe(0.5);
  });

  it('null commits returns 0.5', () => {
    expect(dailyCountTByIndex(null, 0, thresholds)).toBe(0.5);
  });
});

// Tree height/radius: the single source of truth shared by the tree
// renderer (canopy/trunk size) and the firefly orbit field. These tests
// pin the exact arithmetic the two former hand-copies produced.
describe('treeHeight() / treeRadius()', () => {
  // Only the sizing fields matter; cast a partial config to TreesConfig.
  const cfg = {
    MIN_HEIGHT: 8,
    MAX_HEIGHT: 96,
    MIN_WIDTH: 32,
    MAX_WIDTH: 64,
    WIDTH_AGE_FLOOR: 0.5,
    STALE_HORIZON_DAYS: 730,
    STALENESS_CAP: 0.85,
  } as TreesConfig;

  const sizing = buildCommits(
    { date: '2026-01-01', files: 1 }, // oldest, smallest
    { date: '2026-01-11', files: 5 }, // middle
    { date: '2026-01-21', files: 9 } // newest, largest
  );
  const ageRange = computeAgeRange(commitStats(sizing));
  const sizeRange = computeSizeRange(commitStats(sizing));

  describe('treeHeight()', () => {
    it('oldest commit (ageT=0) → MAX_HEIGHT', () => {
      expect(treeHeight(sizing[0], ageRange, cfg)).toBe(96);
    });

    it('newest commit (ageT=1) → MIN_HEIGHT', () => {
      expect(treeHeight(sizing[2], ageRange, cfg)).toBe(8);
    });

    it('middle commit (ageT≈0.5) → midpoint height', () => {
      // 96 - 0.5 * (96 - 8) = 52
      expect(treeHeight(sizing[1], ageRange, cfg)).toBeCloseTo(52, 5);
    });

    it('null commit collapses to the height midpoint', () => {
      // (8 + 96) * 0.5 = 52
      expect(treeHeight(null, ageRange, cfg)).toBe(52);
      expect(treeHeight(undefined, ageRange, cfg)).toBe(52);
    });

    // Absolute-age (staleness) lift: a repo untouched for a while reads old
    // across the whole forest, while keeping intra-repo oldest→newest spread.
    // maturity = staleness + (1 − staleness)·relT, where relT is the existing
    // repo-relative height fraction (oldest = 1, newest = 0). staleness =
    // clamp(daysIdle / STALE_HORIZON_DAYS, 0, STALENESS_CAP), both from cfg.
    describe('staleness lift', () => {
      // scanned exactly on the newest commit → staleness 0 → identical to today.
      const fresh = computeAgeRange(commitStats(sizing), '2026-01-21');
      // scanned 365 days after the newest commit → staleness 0.5.
      const stale = computeAgeRange(commitStats(sizing), '2027-01-21');
      // scanned far in the future → staleness capped at 0.85.
      const ancient = computeAgeRange(commitStats(sizing), '2036-01-21');

      it('a fresh repo is a no-op (heights identical to today)', () => {
        expect(treeHeight(sizing[0], fresh, cfg)).toBe(96); // oldest → MAX
        expect(treeHeight(sizing[1], fresh, cfg)).toBeCloseTo(52, 5); // middle
        expect(treeHeight(sizing[2], fresh, cfg)).toBe(8); // newest → MIN
      });

      it('lifts the whole forest while keeping the oldest at MAX', () => {
        // staleness 0.5: oldest maturity 1 → 96, middle 0.75 → 74, newest 0.5 → 52.
        expect(treeHeight(sizing[0], stale, cfg)).toBeCloseTo(96, 5);
        expect(treeHeight(sizing[1], stale, cfg)).toBeCloseTo(74, 5);
        expect(treeHeight(sizing[2], stale, cfg)).toBeCloseTo(52, 5);
      });

      it('preserves oldest→newest ordering and lifts every tree vs fresh', () => {
        const h = sizing.map((c) => treeHeight(c, stale, cfg));
        expect(h[0]).toBeGreaterThan(h[1]);
        expect(h[1]).toBeGreaterThan(h[2]);
        // Every tree is at least as tall as it was fresh; the newest strictly taller.
        expect(treeHeight(sizing[2], stale, cfg)).toBeGreaterThan(
          treeHeight(sizing[2], fresh, cfg)
        );
      });

      it('honors the staleness cap: the newest tree never fully flattens', () => {
        // maturity = 0.85 → 8 + 0.85·88 = 82.8.
        expect(treeHeight(sizing[2], ancient, cfg)).toBeCloseTo(82.8, 5);
        // The oldest tree stays pinned at MAX regardless of staleness.
        expect(treeHeight(sizing[0], ancient, cfg)).toBeCloseTo(96, 5);
      });

      it('degrades sanely for a same-day (span 0) stale repo', () => {
        const sameDay = buildCommits(
          { date: '2026-01-01', files: 1 },
          { date: '2026-01-01', files: 9 }
        );
        const range = computeAgeRange(commitStats(sameDay), '2027-01-01'); // staleness 0.5
        // relT = 0.5 (span 0) → maturity = 0.5 + 0.5·0.5 = 0.75 → 8 + 0.75·88 = 74.
        const height = treeHeight(sameDay[0], range, cfg);
        expect(Number.isFinite(height)).toBe(true);
        expect(height).toBeCloseTo(74, 5);
      });

      it('is driven by the cfg horizon and cap (settings tune the lift)', () => {
        // Halve the horizon → the same 365 idle days now reads fully stale, but
        // the cap still holds it below 1: newest maturity = cap 0.85 → 82.8.
        const tuned = { ...cfg, STALE_HORIZON_DAYS: 365, STALENESS_CAP: 0.85 } as TreesConfig;
        expect(treeHeight(sizing[2], stale, tuned)).toBeCloseTo(82.8, 5);

        // A cap of 0 disables the lift entirely: heights match the fresh repo.
        const off = { ...cfg, STALENESS_CAP: 0 } as TreesConfig;
        expect(treeHeight(sizing[2], ancient, off)).toBe(8);
        expect(treeHeight(sizing[1], ancient, off)).toBeCloseTo(52, 5);
      });
    });
  });

  describe('treeRadius()', () => {
    it('oldest+smallest: baseRadius=MIN_WIDTH/2, but age-attenuated by floor', () => {
      // sizeT=0 → baseRadius = 32/2 = 16.
      // height = 96 (oldest) → heightRatio = (96-8)/(96-8) = 1.
      // ageAttenuation = floor + (1-floor)*1 = 1 → radius = 16.
      expect(treeRadius(sizing[0], ageRange, sizeRange, cfg)).toBeCloseTo(16, 5);
    });

    it('newest+largest: baseRadius=MAX_WIDTH/2, but shortest tree → floor attenuation', () => {
      // sizeT=1 → baseRadius = 64/2 = 32.
      // height = 8 (newest) → heightRatio = (8-8)/(96-8) = 0.
      // ageAttenuation = floor + (1-floor)*0 = 0.5 → radius = 16.
      expect(treeRadius(sizing[2], ageRange, sizeRange, cfg)).toBeCloseTo(16, 5);
    });

    it('floor=1.0 disables age attenuation (radius = baseRadius)', () => {
      const noFloor = { ...cfg, WIDTH_AGE_FLOOR: 1 } as TreesConfig;
      // sizeT=1 → baseRadius = 32; attenuation = 1 → radius = 32.
      expect(treeRadius(sizing[2], ageRange, sizeRange, noFloor)).toBeCloseTo(32, 5);
    });

    it('null commit uses the midpoint base radius', () => {
      // baseRadius = (16 + 32) * 0.5 = 24.
      // height = midpoint 52 → heightRatio = (52-8)/(96-8) = 0.5.
      // attenuation = 0.5 + 0.5*0.5 = 0.75 → radius = 24 * 0.75 = 18.
      expect(treeRadius(null, ageRange, sizeRange, cfg)).toBeCloseTo(18, 5);
    });
  });
});
