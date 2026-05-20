// skyConfig.test.ts — verifies the SKY_GRADIENT / SKY_STARS / SKY_MOON
// nanostores expose the keys + default values documented in the spec.
// These defaults are the contract between the shader uniforms (sky.ts)
// and the Controls panel UI; a typo here breaks both sides silently.

import { describe, it, expect } from 'vitest';
import { SKY_GRADIENT, SKY_STARS, SKY_MOON } from '@/config/sky.js';

describe('SKY_GRADIENT', () => {
  it('has the expected keys + defaults', () => {
    const v = SKY_GRADIENT.get();
    expect(v.ENABLED).toBe(true);
    expect(v.TOP).toBe('#020208');
    expect(v.UPPER_MID).toBe('#0a0518');
    expect(v.MID).toBe('#150830');
    expect(v.LOWER_MID).toBe('#26104a');
    expect(v.HORIZON).toBe('#3a1860');
    expect(v.STOP_TOP).toBe(0.0);
    expect(v.STOP_UPPER_MID).toBe(0.35);
    expect(v.STOP_MID).toBe(0.55);
    expect(v.STOP_LOWER_MID).toBe(0.75);
    expect(v.STOP_HORIZON).toBe(0.95);
  });
});

describe('SKY_STARS', () => {
  it('has the expected keys + defaults', () => {
    const v = SKY_STARS.get();
    expect(v.ENABLED).toBe(true);
    expect(v.DENSITY).toBeCloseTo(0.0008);
    expect(v.BRIGHTNESS).toBe(1.2);
    expect(v.TWINKLE_ENABLED).toBe(true);
    expect(v.TWINKLE_SPEED).toBe(0.4);
    expect(v.TWINKLE_AMPLITUDE).toBe(0.5);
    expect(v.MIN_ELEVATION_DEG).toBe(8);
  });
});

describe('SKY_MOON', () => {
  it('has the expected keys + defaults', () => {
    const v = SKY_MOON.get();
    expect(v.ENABLED).toBe(false);
    expect(v.AZIMUTH_DEG).toBe(260);
    expect(v.ELEVATION_DEG).toBe(22);
    expect(v.SIZE_DEG).toBe(4.5);
    expect(v.COLOR).toBe('#ffe6c4');
    expect(v.HALO_COLOR).toBe('#ffb86b');
    expect(v.HALO_SIZE_MULT).toBe(4.0);
    expect(v.EMISSION_BOOST).toBe(1.8);
  });
});
