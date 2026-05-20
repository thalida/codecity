// skyConfig.test.ts — verifies the SKY / SKY_STARS nanostores expose
// the keys + default values documented in the spec. These defaults are
// the contract between the shader uniforms (sky.ts) and the Controls
// panel UI; a typo here breaks both sides silently.

import { describe, it, expect } from 'vitest';
import { SKY, SKY_STARS } from '@/config/sky.js';

describe('SKY', () => {
  it('has the expected keys + defaults', () => {
    const v = SKY.get();
    expect(v.ENABLED).toBe(true);
    expect(v.COLOR).toBe('#000000');
    expect(v.GROUND_COLOR).toBe('#000000');
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
