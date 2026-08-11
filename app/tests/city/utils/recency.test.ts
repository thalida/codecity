// The blended recency scale. What matters is not the arithmetic but the two
// failures it exists to prevent: a dormant repo reading fresh, and one edit
// restating every other item.

import { describe, it, expect } from 'vitest';

import { absoluteRecency, recencyT, relativeRecency } from '@/city/utils/recency';
import type { RecencyRange } from '@/city/utils/recency';

const DAY = 86_400_000;
const T0 = Date.UTC(2024, 0, 1);
const days = (n: number) => T0 + n * DAY;

/** A year of history, sampled today. */
const YEAR: RecencyRange = { min: days(0), max: days(365) };
const NOW = days(365);
const cfg = (relativeWeight: number, horizonDays = 730) => ({ horizonDays, relativeWeight });

describe('the absolute half', () => {
  it.each([
    ['dated now', 0, 1],
    ['half a horizon ago', 365, 0.5],
    ['at the horizon', 730, 0],
    ['past the horizon', 3000, 0],
    // A clock skew or a mid-scan write puts a file marginally ahead of now.
    ['dated ahead of now', -5, 1],
  ])('%s', (_label, agoDays, expected) => {
    expect(absoluteRecency(NOW - agoDays * DAY, NOW, 730)).toBeCloseTo(expected, 5);
  });

  it('floors the horizon at a day, so a mis-set 0 cannot divide by zero', () => {
    expect(absoluteRecency(NOW - DAY, NOW, 0)).toBe(0);
    expect(absoluteRecency(NOW, NOW, 0)).toBe(1);
  });
});

describe('the relative half', () => {
  it.each([
    ['newest in the repo', days(365), 1],
    ['oldest in the repo', days(0), 0],
    ['halfway', days(182.5), 0.5],
  ])('%s', (_label, dateMs, expected) => {
    expect(relativeRecency(dateMs, YEAR)).toBeCloseTo(expected, 5);
  });

  it('reads freshest when every date coincides, rather than dividing by zero', () => {
    expect(relativeRecency(days(5), { min: days(5), max: days(5) })).toBe(1);
  });
});

describe('the blend', () => {
  it('is exactly the relative half at weight 1, which is the old behaviour', () => {
    const oldest = recencyT(days(0), NOW, YEAR, cfg(1));
    expect(oldest).toBe(relativeRecency(days(0), YEAR));
    expect(recencyT(days(365), NOW, YEAR, cfg(1))).toBeCloseTo(1, 5);
  });

  it('is exactly the absolute half at weight 0', () => {
    expect(recencyT(days(0), NOW, YEAR, cfg(0))).toBe(absoluteRecency(days(0), NOW, 730));
  });

  it('lands between the two at weight 0.5', () => {
    const date = days(0);
    const mixed = recencyT(date, NOW, YEAR, cfg(0.5));
    const lo = Math.min(absoluteRecency(date, NOW, 730), relativeRecency(date, YEAR));
    const hi = Math.max(absoluteRecency(date, NOW, 730), relativeRecency(date, YEAR));
    expect(mixed).toBeGreaterThan(lo);
    expect(mixed).toBeLessThan(hi);
  });

  it('takes the midpoint for a date it cannot read', () => {
    expect(recencyT(NaN, NOW, YEAR, cfg(0.5))).toBe(0.5);
  });
});

describe('what the blend is for', () => {
  it('reads a dormant repo as old, where rank alone calls its newest file fresh', () => {
    // Same repo, same internal spread, scanned four years later. Under rank
    // alone the newest file is 1 either way, which is the bug.
    const active = recencyT(days(365), days(365), YEAR, cfg(0.5));
    const dormant = recencyT(days(365), days(365 + 4 * 365), YEAR, cfg(0.5));
    expect(relativeRecency(days(365), YEAR)).toBe(1);
    expect(dormant).toBeLessThan(active);
  });

  it('stops one edit from restating every other file, in proportion to the weight', () => {
    // Editing any file moves the range's max to now, so every OTHER file's rank
    // drops. The absolute half does not move, so it damps the shift.
    const other = days(100);
    const before = { min: days(0), max: days(365) };
    const after = { min: days(0), max: days(730) };

    const shiftAtRank = Math.abs(
      recencyT(other, NOW, before, cfg(1)) - recencyT(other, NOW, after, cfg(1))
    );
    const shiftAtBlend = Math.abs(
      recencyT(other, NOW, before, cfg(0.5)) - recencyT(other, NOW, after, cfg(0.5))
    );
    expect(shiftAtBlend).toBeLessThan(shiftAtRank);
    expect(recencyT(other, NOW, before, cfg(0))).toBe(recencyT(other, NOW, after, cfg(0)));
  });

  it('keeps the ordering of a repo older than its horizon, which rank alone would flatten', () => {
    // Everything past the horizon shares an absolute floor of 0, so only the
    // relative half separates them. This is why trees want a higher weight.
    const ancient: RecencyRange = { min: days(-4000), max: days(-3000) };
    const older = recencyT(days(-4000), NOW, ancient, cfg(0.5));
    const newer = recencyT(days(-3000), NOW, ancient, cfg(0.5));
    expect(absoluteRecency(days(-3000), NOW, 730)).toBe(0);
    expect(newer).toBeGreaterThan(older);
  });
});
