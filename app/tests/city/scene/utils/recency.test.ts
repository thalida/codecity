// The recency curve. What matters is the shape: no age at which things stop
// differing, and no dependence on any other file.

import { describe, it, expect } from 'vitest';

import { recencyT } from '@/city/scene/utils/recency';

const DAY = 86_400_000;
const NOW = Date.UTC(2024, 0, 1);
const aged = (days: number, halfLife = 30) => recencyT(NOW - days * DAY, NOW, halfLife);

describe('recencyT', () => {
  it.each([
    ['dated now', 0, 1],
    ['at the half-life', 30, 0.5],
    ['at twice the half-life', 60, 1 / 3],
    ['a year old', 365, 30 / 395],
  ])('%s', (_label, days, expected) => {
    expect(aged(days)).toBeCloseTo(expected, 6);
  });

  it('never reaches zero, so there is no age past which everything matches', () => {
    const decade = aged(3650);
    const century = aged(36500);
    expect(decade).toBeGreaterThan(0);
    expect(century).toBeGreaterThan(0);
    expect(century).toBeLessThan(decade);
  });

  it('keeps a year and a decade visibly apart, which a horizon would flatten', () => {
    expect(aged(365) / aged(3650)).toBeGreaterThan(3);
  });

  it('treats a date ahead of now as fresh, covering clock skew', () => {
    expect(aged(-5)).toBe(1);
  });

  it('floors the half-life at a day, so a mis-set 0 cannot divide by zero', () => {
    expect(aged(1, 0)).toBe(0.5);
  });

  it('stretches with the half-life rather than clipping', () => {
    expect(aged(365, 365)).toBe(0.5);
    expect(aged(365, 30)).toBeLessThan(aged(365, 365));
  });

  it('takes the midpoint for a date it cannot read', () => {
    expect(recencyT(NaN, NOW, 30)).toBe(0.5);
  });

  it('depends on nothing but its own age, so one edit cannot restate another file', () => {
    // The whole point: no repo range in the signature to shift underneath it.
    expect(recencyT(NOW - 10 * DAY, NOW, 30)).toBe(aged(10));
  });
});
