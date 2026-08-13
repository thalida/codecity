import { describe, it, expect } from 'vitest';
import {
  buildScrubberScale,
  commitFraction,
  indexToFraction,
  indexToMs,
  fractionToIndex,
  msToIndex,
  snapToStop,
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

  // 20 commits inside one hour, then a lone commit 100 days later.
  const burstThenGap = [
    ...Array.from({ length: 20 }, (_, i) =>
      new Date(Date.parse('2020-01-01T00:00:00Z') + i * 180_000).toISOString()
    ),
    '2020-04-10T00:00:00Z',
  ];

  it('defaults to pure time: a burst stays true to the clock, however tight', () => {
    const s = buildScrubberScale(burstThenGap);
    expect(s.frac[19] - s.frac[0]).toBeLessThan(0.01);
    // Still strictly ordered, so the commits are distinct points, just close.
    expect(s.frac.every((f, i) => i === 0 || f > s.frac[i - 1])).toBe(true);
  });

  it('a positive index weight gives that burst a floor share of the track', () => {
    const s = buildScrubberScale(burstThenGap, 0.35);
    expect(s.frac[19] - s.frac[0]).toBeGreaterThan(0.3);
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

  it('blending keeps time dominant: a bunched run stays far left of even spacing', () => {
    // 4 commits: 3 bunched in the first two days, 1 far out at day 100.
    const s = buildScrubberScale(['2020-01-01', '2020-01-02', '2020-01-02', '2020-04-10'], 0.35);
    expect(commitFraction(s, 0)).toBeCloseTo(0, 5);
    // Well below its even-spacing slot (2/3), but above the ~0.01 pure time gives.
    expect(commitFraction(s, 2)).toBeLessThan(0.3);
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

// A drag runs through a history where one day can be a fraction of a pixel, so
// it lands on a stop rather than sliding between them.
describe('snapToStop', () => {
  const scale = buildScrubberScale(['2020-01-01', '2020-02-01', '2020-03-01']);
  const dayOf = (pos: number) => new Date(indexToMs(scale, pos)).toISOString().slice(0, 10);

  it('lands on the day the moment falls in', () => {
    const mid = Date.parse('2020-01-15T09:30:00Z');
    expect(dayOf(snapToStop(scale, mid))).toBe('2020-01-15');
  });

  it('gives every day between two commits its own position', () => {
    const a = snapToStop(scale, Date.parse('2020-01-15T00:00:00Z'));
    const b = snapToStop(scale, Date.parse('2020-01-16T00:00:00Z'));
    expect(b).toBeGreaterThan(a);
    expect(dayOf(a)).toBe('2020-01-15');
    expect(dayOf(b)).toBe('2020-01-16');
  });

  // The end of the day, so its floor is that day's last commit: the city on a
  // given day is the city that day left behind.
  it('leaves the last commit at or before it as the state to draw', () => {
    const pos = snapToStop(scale, Date.parse('2020-02-14T12:00:00Z'));
    expect(Math.floor(pos)).toBe(1); // the Feb 1 commit
  });

  // Days alone would strand these: a history inside one day snaps whole to that
  // day, leaving every commit in it but the last out of reach.
  it('reaches each commit of a busy day', () => {
    const busy = buildScrubberScale([
      '2020-01-01T01:00:00Z',
      '2020-01-01T09:00:00Z',
      '2020-01-01T17:00:00Z',
    ]);
    expect(snapToStop(busy, Date.parse('2020-01-01T02:00:00Z'))).toBe(0);
    expect(snapToStop(busy, Date.parse('2020-01-01T08:30:00Z'))).toBe(1);
    expect(snapToStop(busy, Date.parse('2020-01-01T16:00:00Z'))).toBe(2);
  });

  // A day stop hours from a commit's tick reads as the snap having missed it.
  it('parks on the tick, not beside it, on a day that has commits', () => {
    const busy = buildScrubberScale(['2020-01-01T09:00:00Z', '2020-02-01T09:00:00Z']);
    // Evening of the commit's own day: the day's end is nearer in raw distance,
    // but that day is already spoken for by its commit.
    expect(busy.ms[0]).toBe(indexToMs(busy, snapToStop(busy, Date.parse('2020-01-01T20:00:00Z'))));
  });

  it('stays inside the history at either end', () => {
    expect(snapToStop(scale, Date.parse('2019-01-01T00:00:00Z'))).toBe(0);
    expect(snapToStop(scale, Date.parse('2030-01-01T00:00:00Z'))).toBe(2);
  });
});

describe('msToIndex', () => {
  const scale = buildScrubberScale(['2020-01-01', '2020-02-01', '2020-03-01']);

  it('inverts indexToMs', () => {
    for (const pos of [0, 0.25, 1, 1.5, 2]) {
      expect(msToIndex(scale, indexToMs(scale, pos))).toBeCloseTo(pos, 6);
    }
  });

  it('clamps outside the history', () => {
    expect(msToIndex(scale, 0)).toBe(0);
    expect(msToIndex(scale, Date.parse('2099-01-01'))).toBe(2);
  });
});
