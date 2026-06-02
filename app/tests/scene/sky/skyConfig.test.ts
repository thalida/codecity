// skyConfig.test.ts — verifies the SCENE store exposes the sky/stars keys with
// the right types. The contract between sky.ts (shader uniforms) and the
// Controls panel is that THESE KEYS exist with these types; the specific
// default values are tunable and shouldn't break this test when changed.

import { describe, it, expect } from 'vitest';
import { SCENE } from '@/state/stores/settings/scene';

describe('SCENE sky/stars keys', () => {
  it('exposes the expected keys with the right types', () => {
    const v = SCENE.value;
    expect(v.SKY_COLOR).toMatch(/^#[0-9a-f]{6}$/i);
    expect(typeof v.STARS_ENABLED).toBe('boolean');
    expect(typeof v.STARS_DENSITY).toBe('number');
  });
});
