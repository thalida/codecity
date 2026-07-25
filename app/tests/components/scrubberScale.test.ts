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
    expect(s.ms[0]).toBe(Date.parse('2020-01-01'));
    expect(s.ms[3]).toBe(Date.parse('2020-01-10'));
  });

  it('separates same-day commits once dates carry a time', () => {
    // The whole point of full timestamps: three commits on one day used to share
    // an identical ms, so they stacked on one tick and none could be dragged to.
    const s = buildScrubberScale([
      '2026-07-24T09:00:00Z',
      '2026-07-24T13:00:00Z',
      '2026-07-24T17:00:00Z',
    ]);
    expect(s.frac[0]).toBeLessThan(s.frac[1]);
    expect(s.frac[1]).toBeLessThan(s.frac[2]);
    expect(fractionToIndex(s, s.frac[1])).toBeCloseTo(1, 5);
  });

  it('gives a burst a floor share of the track so its commits stay reachable', () => {
    // 20 commits inside one hour, then a lone commit 100 days later. On a pure
    // time axis the burst would occupy ~0.04% of the track and be undraggable.
    const burst = Array.from({ length: 20 }, (_, i) =>
      new Date(Date.parse('2020-01-01T00:00:00Z') + i * 180_000).toISOString()
    );
    const s = buildScrubberScale([...burst, '2020-04-10T00:00:00Z']);
    const spread = s.frac[19] - s.frac[0];
    expect(spread).toBeGreaterThan(0.3);
    // Every commit is still strictly ordered, so each has its own click target.
    expect(s.frac.every((f, i) => i === 0 || f > s.frac[i - 1])).toBe(true);
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

  it('a single-instant history scrubs by even index spacing, not a collapsed axis', () => {
    // Zero time span, so the axis falls back to pure index spacing rather than
    // stacking all four on the left edge.
    const s = buildScrubberScale(['2026-07-24', '2026-07-24', '2026-07-24', '2026-07-24']);
    expect(indexToFraction(s, 0)).toBe(0); // oldest at the left
    expect(indexToFraction(s, 3)).toBe(1); // newest (present) at the right
    expect(indexToFraction(s, 1)).toBeCloseTo(1 / 3, 5);
    expect(commitFraction(s, 2)).toBeCloseTo(2 / 3, 5);
    // Dragging maps back to a float commit index, so scrubbing lands on commits.
    expect(fractionToIndex(s, 0)).toBe(0);
    expect(fractionToIndex(s, 1)).toBe(3);
    expect(fractionToIndex(s, 0.5)).toBeCloseTo(1.5, 5);
  });

  it('still clusters by time: a bunched run stays far left of even spacing', () => {
    // 4 commits: 3 bunched in the first two days, 1 far out at day 100.
    const s = buildScrubberScale(['2020-01-01', '2020-01-02', '2020-01-02', '2020-04-10']);
    expect(commitFraction(s, 0)).toBeCloseTo(0, 5);
    // Time dominates, so index 2 sits well below its even-spacing slot (2/3)...
    expect(commitFraction(s, 2)).toBeLessThan(0.3);
    // ...but above the ~0.01 a pure time axis would crush it to.
    expect(commitFraction(s, 2)).toBeGreaterThan(0.05);
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
