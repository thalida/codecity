// skyConfig.test.ts — verifies the SKY_GRADIENT / SKY_STARS nanostores
// expose the keys + default values documented in the spec. These
// defaults are the contract between the shader uniforms (sky.ts) and
// the Controls panel UI; a typo here breaks both sides silently.

import { describe, it, expect } from 'vitest';
import { SKY_GRADIENT, SKY_STARS } from '@/config/sky.js';

describe('SKY_GRADIENT', () => {
  it('has the expected keys + defaults', () => {
    const v = SKY_GRADIENT.get();
    expect(v.ENABLED).toBe(true);
    expect(v.TOP).toBe('#000000');
    expect(v.UPPER_MID).toBe('#000002');
    expect(v.MID).toBe('#01010a');
    expect(v.LOWER_MID).toBe('#020213');
    expect(v.HORIZON).toBe('#05041e');
    expect(v.GROUND_COLOR).toBe('#000000');
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
    expect(v.DENSITY).toBeCloseTo(0.0075);
    expect(v.SIZE).toBeCloseTo(0.15);
    expect(v.BRIGHTNESS).toBe(1.2);
    expect(v.TWINKLE_ENABLED).toBe(true);
    expect(v.TWINKLE_SPEED).toBe(0.5);
    expect(v.TWINKLE_AMPLITUDE).toBe(1.0);
    expect(v.MIN_ELEVATION_DEG).toBe(8);
  });
});
