// skyConfig.test.ts — verifies the SKY / SKY_STARS nanostores expose
// the keys with the right types. The contract between sky.ts (shader
// uniforms) and the Controls panel is that THESE KEYS exist with
// these types; the specific default values are tunable and shouldn't
// break this test when changed.

import { describe, it, expect } from 'vitest';
import { SKY, SKY_STARS } from '@/state/settings/components/sky.js';

describe('SKY', () => {
  it('exposes the expected keys with the right types', () => {
    const v = SKY.get();
    expect(v.COLOR).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe('SKY_STARS', () => {
  it('exposes the expected keys with the right types', () => {
    const v = SKY_STARS.get();
    expect(typeof v.ENABLED).toBe('boolean');
    expect(typeof v.DENSITY).toBe('number');
  });
});
