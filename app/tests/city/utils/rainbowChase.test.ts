// app/tests/city/utils/rainbowChase.test.ts
//
// rainbowRgbAt(timeMs, fraction) is the single rainbow-chase hue kernel shared
// by the tree / building / firefly outlines and the gem→selection path line.
// It must reproduce the hand-copied formula verbatim:
//   t   = timeMs * RAINBOW.SPEED
//   hue = (((t + fraction) % 1) + 1) % 1
//   rgb = THREE.Color.setHSL(hue, RAINBOW.SATURATION, RAINBOW.LIGHTNESS)
import { describe, it, expect, afterEach } from 'vitest';
import * as THREE from 'three';
import { rainbowRgbAt } from '@/city/utils/rainbowChase';
import { RAINBOW, type RainbowConfig } from '@/state/stores/settings/effects';

const DEFAULT = RAINBOW.peek();

afterEach(() => {
  RAINBOW.value = DEFAULT;
});

// Reference implementation: exactly the math the call sites used inline.
function expectedRgb(timeMs: number, fraction: number, cfg: RainbowConfig) {
  const t = timeMs * cfg.SPEED;
  const hue = (((t + fraction) % 1) + 1) % 1;
  const c = new THREE.Color().setHSL(hue, cfg.SATURATION, cfg.LIGHTNESS);
  return [c.r, c.g, c.b];
}

describe('rainbowRgbAt', () => {
  it('matches THREE.Color.setHSL for a known time + fraction', () => {
    const cfg: RainbowConfig = { SPEED: 0.001, SATURATION: 1, LIGHTNESS: 0.5 };
    RAINBOW.value = cfg;
    const [r, g, b] = rainbowRgbAt(1000, 0); // t = 1.0 → hue wraps to 0 → red
    const [er, eg, eb] = expectedRgb(1000, 0, cfg);
    expect(r).toBeCloseTo(er, 6);
    expect(g).toBeCloseTo(eg, 6);
    expect(b).toBeCloseTo(eb, 6);
    // hue 0 at full sat / 0.5 light = pure red in linear-RGB (setHSL's space).
    expect(r).toBeCloseTo(1, 6);
    expect(g).toBeCloseTo(0, 6);
    expect(b).toBeCloseTo(0, 6);
  });

  it('wraps negative (t + fraction) into [0,1)', () => {
    const cfg: RainbowConfig = { SPEED: -1, SATURATION: 1, LIGHTNESS: 0.5 };
    RAINBOW.value = cfg;
    // t = -0.25 → t + 0 = -0.25 → wraps to 0.75
    const [r, g, b] = rainbowRgbAt(0.25, 0);
    const [er, eg, eb] = expectedRgb(0.25, 0, cfg);
    expect(r).toBeCloseTo(er, 6);
    expect(g).toBeCloseTo(eg, 6);
    expect(b).toBeCloseTo(eb, 6);
  });

  it('respects SPEED — time advances the hue', () => {
    RAINBOW.value = { SPEED: 0.001, SATURATION: 1, LIGHTNESS: 0.5 };
    const a = [...rainbowRgbAt(0, 0)];
    const b = [...rainbowRgbAt(100, 0)]; // t = 0.1 → hue 0.1, different color
    expect(b).not.toEqual(a);
  });

  it('respects SATURATION and LIGHTNESS', () => {
    // Saturation 0 → grey: r == g == b == LIGHTNESS regardless of hue.
    RAINBOW.value = { SPEED: 0.001, SATURATION: 0, LIGHTNESS: 0.42 };
    const [r, g, b] = rainbowRgbAt(123, 0.37);
    expect(r).toBeCloseTo(0.42, 6);
    expect(g).toBeCloseTo(0.42, 6);
    expect(b).toBeCloseTo(0.42, 6);
  });

  it('the fraction offsets the hue (chase around the shape)', () => {
    RAINBOW.value = { SPEED: 0, SATURATION: 1, LIGHTNESS: 0.5 };
    // SPEED 0 → t = 0 → hue == fraction.
    const red = rainbowRgbAt(999, 0); // hue 0 → red
    expect(red[0]).toBeCloseTo(1, 6);
    expect(red[1]).toBeCloseTo(0, 6);
    const third = [...rainbowRgbAt(999, 1 / 3)]; // hue 1/3 → green
    expect(third[1]).toBeCloseTo(1, 6);
    expect(third[0]).toBeCloseTo(0, 6);
  });

  it('writes into the provided out tuple and returns it', () => {
    RAINBOW.value = { SPEED: 0.001, SATURATION: 1, LIGHTNESS: 0.5 };
    const out: [number, number, number] = [9, 9, 9];
    const ret = rainbowRgbAt(0, 0, out);
    expect(ret).toBe(out);
    expect(out[0]).toBeCloseTo(1, 6);
  });
});
