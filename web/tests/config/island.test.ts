import { describe, it, expect } from 'vitest';
import {
  ISLAND_GEOMETRY,
  ISLAND_MATERIALS,
  ISLAND_UNDERGLOW,
} from '@/config/island.js';

describe('ISLAND config defaults', () => {
  it('GEOMETRY has expected default fields', () => {
    const g = ISLAND_GEOMETRY.get();
    expect(g.ENABLED).toBe(true);
    expect(g.SIDES).toBe(32);
    expect(g.IRREGULARITY).toBeCloseTo(0.12, 2);
    expect(g.TIERS).toBe(5);
    expect(g.DEPTH).toBeCloseTo(1.2, 2);
    expect(g.ROUNDNESS).toBeCloseTo(0.7, 2);
    expect(g.GRASS_THICKNESS).toBeCloseTo(0.025, 3);
  });

  it('MATERIALS provides grass + rock + hemispheric lighting colors', () => {
    const m = ISLAND_MATERIALS.get();
    expect(m.GRASS_COLOR).toMatch(/^#[0-9a-f]{6}$/i);
    expect(m.GRASS_SIDE_COLOR).toMatch(/^#[0-9a-f]{6}$/i);
    expect(m.ROCK_COLOR).toMatch(/^#[0-9a-f]{6}$/i);
    expect(m.HEMI_SKY_COLOR).toMatch(/^#[0-9a-f]{6}$/i);
    expect(m.HEMI_GROUND_COLOR).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('UNDERGLOW has master toggle, color, strength, and core controls', () => {
    const u = ISLAND_UNDERGLOW.get();
    expect(u.ENABLED).toBe(false);
    expect(u.COLOR).toBe('#ff5530');
    expect(u.STRENGTH).toBeGreaterThanOrEqual(0);
    expect(u.STRENGTH).toBeLessThanOrEqual(2);
    expect(typeof u.CORE_ENABLED).toBe('boolean');
    expect(u.CORE_INTENSITY).toBeGreaterThan(0);
  });

});
