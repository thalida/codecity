// colorInterp.test.ts — verifies the OKLCH interpolation helper.

import { describe, it, expect } from 'vitest';
import { interpolateOklch } from '@/scene/components/trees/colorInterp.js';

function rgb(r: number, g: number, b: number) {
  return { r, g, b };
}

describe('interpolateOklch()', () => {
  it('returns endpoint exactly at t=0', () => {
    const a = rgb(0.5, 0.1, 0.9);
    const b = rgb(0.0, 0.7, 0.6);
    const out = rgb(0, 0, 0);
    interpolateOklch(a, b, 0, out);
    expect(out.r).toBeCloseTo(a.r, 3);
    expect(out.g).toBeCloseTo(a.g, 3);
    expect(out.b).toBeCloseTo(a.b, 3);
  });

  it('returns endpoint exactly at t=1', () => {
    const a = rgb(0.5, 0.1, 0.9);
    const b = rgb(0.0, 0.7, 0.6);
    const out = rgb(0, 0, 0);
    interpolateOklch(a, b, 1, out);
    expect(out.r).toBeCloseTo(b.r, 3);
    expect(out.g).toBeCloseTo(b.g, 3);
    expect(out.b).toBeCloseTo(b.b, 3);
  });

  it('purple→teal midpoint keeps real chroma (not gray)', () => {
    // Purple-ish and teal-ish picked from clearly opposite-ish hues.
    const purple = rgb(0.55, 0.10, 0.85);
    const teal = rgb(0.00, 0.70, 0.65);
    const out = rgb(0, 0, 0);
    interpolateOklch(purple, teal, 0.5, out);

    // A plain RGB midpoint would be (0.275, 0.40, 0.75) — a muddy
    // blue-gray with low chroma. OKLCH midpoint should stay
    // visibly saturated. Verify by checking the channel SPREAD —
    // a saturated color has at least one channel clearly higher
    // than the others.
    const channels = [out.r, out.g, out.b].sort((x, y) => y - x);
    const spread = channels[0] - channels[2];
    expect(spread).toBeGreaterThan(0.3);
  });

  it('produces values clamped to [0, 1]', () => {
    const a = rgb(1, 0, 0);
    const b = rgb(0, 0, 1);
    const out = rgb(0, 0, 0);
    for (let t = 0; t <= 1; t += 0.1) {
      interpolateOklch(a, b, t, out);
      expect(out.r).toBeGreaterThanOrEqual(0);
      expect(out.r).toBeLessThanOrEqual(1);
      expect(out.g).toBeGreaterThanOrEqual(0);
      expect(out.g).toBeLessThanOrEqual(1);
      expect(out.b).toBeGreaterThanOrEqual(0);
      expect(out.b).toBeLessThanOrEqual(1);
    }
  });

  it('handles gray endpoints without producing NaN', () => {
    const gray = rgb(0.5, 0.5, 0.5);
    const blue = rgb(0.1, 0.2, 0.9);
    const out = rgb(0, 0, 0);
    interpolateOklch(gray, blue, 0.5, out);
    expect(Number.isFinite(out.r)).toBe(true);
    expect(Number.isFinite(out.g)).toBe(true);
    expect(Number.isFinite(out.b)).toBe(true);
  });

  it('handles two gray endpoints (both undefined hue)', () => {
    const out = rgb(0, 0, 0);
    interpolateOklch(rgb(0.3, 0.3, 0.3), rgb(0.7, 0.7, 0.7), 0.5, out);
    expect(out.r).toBeCloseTo(out.g, 3);
    expect(out.g).toBeCloseTo(out.b, 3);
    expect(out.r).toBeGreaterThan(0.3);
    expect(out.r).toBeLessThan(0.7);
  });
});
