import { describe, it, expect } from 'vitest';
import {
  ISLAND_GEOMETRY,
  ISLAND_MATERIALS,
  ISLAND_UNDERGLOW,
  ISLAND_ATMOSPHERE,
} from '@/config/island.js';

describe('ISLAND config defaults', () => {
  it('GEOMETRY has expected default fields', () => {
    const g = ISLAND_GEOMETRY.get();
    expect(g.ENABLED).toBe(true);
    expect(g.SIDES).toBe(12);
    expect(g.IRREGULARITY).toBeCloseTo(0.32, 2);
    expect(g.TIERS).toBe(4);
    expect(g.DEPTH).toBeCloseTo(1.2, 2);
  });

  it('MATERIALS provides grass + soil + 3-tier rock colors', () => {
    const m = ISLAND_MATERIALS.get();
    expect(m.GRASS_COLOR).toMatch(/^#[0-9a-f]{6}$/i);
    expect(m.SOIL_COLOR).toMatch(/^#[0-9a-f]{6}$/i);
    expect(m.ROCK_LIGHT).toMatch(/^#[0-9a-f]{6}$/i);
    expect(m.ROCK_MID).toMatch(/^#[0-9a-f]{6}$/i);
    expect(m.ROCK_DARK).toMatch(/^#[0-9a-f]{6}$/i);
    expect(m.SUN_CONTRAST).toBeGreaterThan(0);
    expect(m.AMBIENT).toBeGreaterThan(0);
  });

  it('UNDERGLOW has master toggle, color, strength, and core controls', () => {
    const u = ISLAND_UNDERGLOW.get();
    expect(u.ENABLED).toBe(true);
    expect(u.COLOR).toBe('#ff5530');
    expect(u.STRENGTH).toBeGreaterThanOrEqual(0);
    expect(u.STRENGTH).toBeLessThanOrEqual(2);
    expect(typeof u.CORE_ENABLED).toBe('boolean');
    expect(u.CORE_INTENSITY).toBeGreaterThan(0);
  });

  it('ATMOSPHERE has distance-fog and shadow-disc fields', () => {
    const a = ISLAND_ATMOSPHERE.get();
    expect(typeof a.DISTANCE_FOG_ENABLED).toBe('boolean');
    expect(a.DISTANCE_FOG_COLOR).toMatch(/^#[0-9a-f]{6}$/i);
    expect(a.DISTANCE_FOG_NEAR).toBeGreaterThan(0);
    expect(a.DISTANCE_FOG_FAR).toBeGreaterThan(a.DISTANCE_FOG_NEAR);
    expect(typeof a.SHADOW_DISC_ENABLED).toBe('boolean');
    expect(a.SHADOW_DISC_OPACITY).toBeGreaterThanOrEqual(0);
    expect(a.SHADOW_DISC_OPACITY).toBeLessThanOrEqual(1);
    expect(a.SHADOW_DROP_DISTANCE).toBeGreaterThan(0);
  });
});
