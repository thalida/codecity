// The rainbow-chase hue kernel shared by the tree / building / firefly outlines
// and the gem-to-selection path line. Expected values are literal: a reference
// implementation here would only restate the formula under test.
import { describe, it, expect } from 'vitest';
import { rainbowRgbAt } from '../../src/utils/rainbowChase';

describe('rainbowRgbAt', () => {
  it('hue 0 at full saturation is pure red', () => {
    const rb = { SPEED: 0.001, SATURATION: 1, LIGHTNESS: 0.5 };
    // t = 1000 * 0.001 = 1.0, which wraps to hue 0.
    const [r, g, b] = rainbowRgbAt(1000, 0, rb);
    expect(r).toBeCloseTo(1, 6);
    expect(g).toBeCloseTo(0, 6);
    expect(b).toBeCloseTo(0, 6);
  });

  it('wraps a negative (t + fraction) into [0,1)', () => {
    const rb = { SPEED: -1, SATURATION: 1, LIGHTNESS: 0.5 };
    // t = -0.25, which wraps to hue 0.75: violet, blue-dominant.
    const [r, g, b] = rainbowRgbAt(0.25, 0, rb);
    expect(r).toBeCloseTo(0.5, 6);
    expect(g).toBeCloseTo(0, 6);
    expect(b).toBeCloseTo(1, 6);
  });

  it('respects SPEED — time advances the hue', () => {
    const rb = { SPEED: 0.001, SATURATION: 1, LIGHTNESS: 0.5 };
    const a = [...rainbowRgbAt(0, 0, rb)];
    const b = [...rainbowRgbAt(100, 0, rb)]; // t = 0.1 → hue 0.1, different color
    expect(b).not.toEqual(a);
  });

  it('respects SATURATION and LIGHTNESS', () => {
    // Saturation 0 → grey: r == g == b == LIGHTNESS regardless of hue.
    const rb = { SPEED: 0.001, SATURATION: 0, LIGHTNESS: 0.42 };
    const [r, g, b] = rainbowRgbAt(123, 0.37, rb);
    expect(r).toBeCloseTo(0.42, 6);
    expect(g).toBeCloseTo(0.42, 6);
    expect(b).toBeCloseTo(0.42, 6);
  });

  it('the fraction offsets the hue (chase around the shape)', () => {
    const rb = { SPEED: 0, SATURATION: 1, LIGHTNESS: 0.5 };
    // SPEED 0 → t = 0 → hue == fraction.
    const red = rainbowRgbAt(999, 0, rb); // hue 0 → red
    expect(red[0]).toBeCloseTo(1, 6);
    expect(red[1]).toBeCloseTo(0, 6);
    const third = [...rainbowRgbAt(999, 1 / 3, rb)]; // hue 1/3 → green
    expect(third[1]).toBeCloseTo(1, 6);
    expect(third[0]).toBeCloseTo(0, 6);
  });

  it('writes into the provided out tuple and returns it', () => {
    const rb = { SPEED: 0.001, SATURATION: 1, LIGHTNESS: 0.5 };
    const out: [number, number, number] = [9, 9, 9];
    const ret = rainbowRgbAt(0, 0, rb, out);
    expect(ret).toBe(out);
    expect(out[0]).toBeCloseTo(1, 6);
  });
});
