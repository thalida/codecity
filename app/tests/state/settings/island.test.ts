import { describe, it, expect } from 'vitest';
import { ISLAND } from '@/state/stores/settings/island';

describe('ISLAND config defaults', () => {
  it('GEOMETRY exposes the expected keys with the right types', () => {
    // Asserting shape, not specific values — tuning the production
    // defaults shouldn't break this test.
    const g = ISLAND.value;
    expect(typeof g.ENABLED).toBe('boolean');
    expect(typeof g.SIDES).toBe('number');
    expect(typeof g.IRREGULARITY).toBe('number');
    expect(typeof g.TIERS).toBe('number');
    expect(typeof g.DEPTH).toBe('number');
    expect(typeof g.ROUNDNESS).toBe('number');
    expect(typeof g.GRASS_THICKNESS).toBe('number');
  });

  it('MATERIALS provides grass + rock + hemispheric lighting colors', () => {
    const m = ISLAND.value;
    expect(m.GRASS_COLOR).toMatch(/^#[0-9a-f]{6}$/i);
    expect(m.GRASS_SIDE_COLOR).toMatch(/^#[0-9a-f]{6}$/i);
    expect(m.ROCK_COLOR).toMatch(/^#[0-9a-f]{6}$/i);
    expect(m.HEMI_SKY_COLOR).toMatch(/^#[0-9a-f]{6}$/i);
    expect(m.HEMI_GROUND_COLOR).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
