import { describe, it, expect } from 'vitest';
import { getWorldBounds } from '@/city/utils/floorBounds';
import { citySettings } from '../../_helpers/citySettings';
import { bbox } from '../../_helpers/cityFixtures';

// The formulas assume GROUND_BUFFER_PERCENT 30, stated here rather than taken
// from the defaults, which have shifted before.
const WORLD_30 = citySettings({ WORLD: { GROUND_BUFFER_PERCENT: 30 } }).WORLD;

describe('worldBounds', () => {
  it('returns fallback rectangle when bbox is null', () => {
    const b = getWorldBounds(null, WORLD_30);
    expect(b.cx).toBe(0);
    expect(b.cz).toBe(0);
    expect(b.halfWidth).toBeGreaterThan(0);
    expect(b.halfDepth).toBeGreaterThan(0);
    expect(b.halfWidth).toBe(b.halfDepth);
  });

  it('returns fallback when bbox is undefined', () => {
    const b = getWorldBounds(undefined, WORLD_30);
    expect(b.cx).toBe(0);
    expect(b.cz).toBe(0);
  });

  it('centers on bbox center', () => {
    const b = getWorldBounds(bbox(100, 200, 1100, 1200), WORLD_30);
    expect(b.cx).toBe(600);
    expect(b.cz).toBe(700);
  });

  it('half-width is half the bbox width plus buffer', () => {
    // bbox 10000-wide, no height: characteristic = 10000, buffer = max(800, 10000*0.30) = 3000.
    // halfWidth = 10000/2 + 3000 = 8000.
    const b = getWorldBounds(bbox(0, 0, 10000, 10000), WORLD_30);
    expect(b.halfWidth).toBe(8000);
    expect(b.halfDepth).toBe(8000);
  });

  it('buffer applies the SAME absolute amount to both axes', () => {
    // 10000-wide × 100-deep. characteristic = 10000, buffer = 3000.
    // halfWidth = 10000/2 + 3000 = 8000. halfDepth = 100/2 + 3000 = 3050.
    const b = getWorldBounds(bbox(0, 0, 10000, 100), WORLD_30);
    expect(b.halfWidth).toBe(8000);
    expect(b.halfDepth).toBe(3050);
  });

  it('tiny cities get tiny bounds (no floor; slider always meaningful)', () => {
    // 10-wide bbox. characteristic = 10, 10*0.30 = 3, halfWidth = 10/2 + 3 = 8.
    // Any minimum buffer here would swamp a small repo and flatten its slider.
    const b = getWorldBounds(bbox(0, 0, 10, 10), WORLD_30);
    expect(b.halfWidth).toBe(8);
    expect(b.halfDepth).toBe(8);
  });

  it('cityHeight feeds the characteristic-size calc for tiny-tall cities', () => {
    // A 100-wide footprint under a 5000-tall building: characteristic 5000,
    // buffer 1500, halfWidth 50 + 1500.
    const b = getWorldBounds(bbox(0, 0, 100, 100), WORLD_30, 5000);
    expect(b.halfWidth).toBe(1550);
    expect(b.halfDepth).toBe(1550);
  });

  it('GROUND_BUFFER_PERCENT slider scales the buffer linearly', () => {
    const world60 = citySettings({ WORLD: { GROUND_BUFFER_PERCENT: 60 } }).WORLD;
    // 10000-wide. characteristic = 10000, buffer = 10000*0.60 = 6000.
    // halfWidth = 10000/2 + 6000 = 11000.
    const b = getWorldBounds(bbox(0, 0, 10000, 10000), world60);
    expect(b.halfWidth).toBe(11000);
  });
});
