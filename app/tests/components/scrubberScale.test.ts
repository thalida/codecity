import { describe, it, expect } from 'vitest';
import {
  buildScrubberScale,
  commitFraction,
  indexToFraction,
  fractionToIndex,
} from '@/components/TimeTravelBar/scrubberScale';

const DAY = 86_400_000;

describe('scrubberScale', () => {
  it('clamps locally out-of-order commit dates to non-decreasing', () => {
    const s = buildScrubberScale(['2020-01-01', '2020-01-05', '2020-01-03', '2020-01-10']);
    // index 2 (Jan 3) sits before its predecessor (Jan 5) → clamped up to Jan 5.
    expect(s.ms[2]).toBe(s.ms[1]);
    expect(s.ms.every((m, i) => i === 0 || m >= s.ms[i - 1])).toBe(true);
    expect(s.minMs).toBe(Date.parse('2020-01-01'));
    expect(s.maxMs).toBe(Date.parse('2020-01-10'));
  });

  it('pins a single-commit repo to the present (right edge), inert to drags', () => {
    const s = buildScrubberScale(['2026-07-24']);
    // The lone commit IS the present: handle + its tick sit at the far right.
    expect(indexToFraction(s, 0)).toBe(1);
    expect(commitFraction(s, 0)).toBe(1);
    // Clicking anywhere can't move off the only commit.
    expect(fractionToIndex(s, 0)).toBe(0);
    expect(fractionToIndex(s, 0.5)).toBe(0);
    expect(fractionToIndex(s, 1)).toBe(0);
  });

  it('span floors at 1 for a single-day (degenerate) range', () => {
    const s = buildScrubberScale(['2020-01-01', '2020-01-01']);
    expect(s.span).toBe(1);
    // No divide-by-zero: fractions collapse to 0.
    expect(indexToFraction(s, 1)).toBe(0);
  });

  it('places a commit tick at its own date fraction (clusters by time, not index)', () => {
    // 4 commits: 3 bunched in the first two days, 1 far out at day 100.
    const s = buildScrubberScale(['2020-01-01', '2020-01-02', '2020-01-02', '2020-04-10']);
    // The three early commits all land in the first ~2% of the axis...
    expect(commitFraction(s, 0)).toBeCloseTo(0, 5);
    expect(commitFraction(s, 2)).toBeLessThan(0.03);
    // ...while the last one anchors the far end.
    expect(commitFraction(s, 3)).toBeCloseTo(1, 5);
  });

  it('indexToFraction interpolates the date between two commits', () => {
    const s = buildScrubberScale(['2020-01-01', '2020-01-11']); // 10 days apart
    // Halfway between the two commit indices == 5 days in == 0.5 of the span.
    expect(indexToFraction(s, 0.5)).toBeCloseTo(0.5, 5);
    expect(indexToFraction(s, 0)).toBe(0);
    expect(indexToFraction(s, 1)).toBe(1);
  });

  it('fractionToIndex inverts indexToFraction across a lumpy timeline', () => {
    const s = buildScrubberScale([
      '2020-01-01',
      '2020-01-02',
      '2020-06-01', // big time gap here
      '2020-06-02',
      '2020-06-03',
    ]);
    for (const pos of [0, 0.5, 1.4, 2, 3.25, 4]) {
      const frac = indexToFraction(s, pos);
      expect(fractionToIndex(s, frac)).toBeCloseTo(pos, 4);
    }
  });

  it('fractionToIndex lands on the commit nearest a clicked date, not the nearest index', () => {
    // Days 0,1,2 then a lone commit at day 100. Clicking the middle of the axis
    // (day ~50) should resolve BETWEEN index 2 (day 2) and 3 (day 100), i.e. ~2.5,
    // NOT index 1.5 (which an index-linear scrubber would give).
    const s = buildScrubberScale(['2020-01-01', '2020-01-02', '2020-01-03', '2020-04-10']);
    const idx = fractionToIndex(s, 0.5);
    expect(idx).toBeGreaterThan(2);
    expect(idx).toBeLessThan(3);
  });

  it('clamps fractions outside [0,1] to the endpoints', () => {
    const s = buildScrubberScale(['2020-01-01', '2020-01-02', '2020-01-03']);
    expect(fractionToIndex(s, -1)).toBe(0);
    expect(fractionToIndex(s, 2)).toBe(2);
  });

  it('handles an empty commit set without throwing', () => {
    const empty = buildScrubberScale([]);
    expect(commitFraction(empty, 0)).toBe(0);
    expect(indexToFraction(empty, 0)).toBe(0);
    expect(fractionToIndex(empty, 0.5)).toBe(0);
  });

  it('a uniform daily cadence maps index fraction ≈ date fraction', () => {
    const dates = Array.from({ length: 11 }, (_, i) =>
      new Date(Date.parse('2020-01-01') + i * DAY).toISOString().slice(0, 10)
    );
    const s = buildScrubberScale(dates);
    expect(indexToFraction(s, 5)).toBeCloseTo(0.5, 5);
    expect(fractionToIndex(s, 0.5)).toBeCloseTo(5, 5);
  });
});
