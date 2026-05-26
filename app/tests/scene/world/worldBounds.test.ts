import { describe, it, expect, beforeEach } from 'vitest';
import { getWorldBounds } from '@/scene/layout/worldBounds.js';
import { WORLD } from '@/config/world/world.js';
import type { CityBbox } from '@/types';

function bbox(minX: number, minY: number, maxX: number, maxY: number): CityBbox {
  return {
    minX,
    minY,
    maxX,
    maxY,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    width: maxX - minX,
    depth: maxY - minY,
  };
}

// All formulas below assume the default GROUND_BUFFER_PERCENT of 30 and
// MIN_BUFFER floor of 800. We pin both via beforeEach so the test stays
// stable when the defaults shift again.
describe('worldBounds', () => {
  beforeEach(() => {
    WORLD.setKey('GROUND_BUFFER_PERCENT', 30);
  });

  it('returns fallback rectangle when bbox is null', () => {
    const b = getWorldBounds(null);
    expect(b.cx).toBe(0);
    expect(b.cz).toBe(0);
    expect(b.halfWidth).toBeGreaterThan(0);
    expect(b.halfDepth).toBeGreaterThan(0);
    expect(b.halfWidth).toBe(b.halfDepth);
  });

  it('returns fallback when bbox is undefined', () => {
    const b = getWorldBounds(undefined);
    expect(b.cx).toBe(0);
    expect(b.cz).toBe(0);
  });

  it('centers on bbox center', () => {
    const b = getWorldBounds(bbox(100, 200, 1100, 1200));
    expect(b.cx).toBe(600);
    expect(b.cz).toBe(700);
  });

  it('half-width is half the bbox width plus buffer', () => {
    // bbox 10000-wide, no height: characteristic = 10000, buffer = max(800, 10000*0.30) = 3000.
    // halfWidth = 10000/2 + 3000 = 8000.
    const b = getWorldBounds(bbox(0, 0, 10000, 10000));
    expect(b.halfWidth).toBe(8000);
    expect(b.halfDepth).toBe(8000);
  });

  it('buffer applies the SAME absolute amount to both axes', () => {
    // 10000-wide × 100-deep. characteristic = 10000, buffer = 3000.
    // halfWidth = 10000/2 + 3000 = 8000. halfDepth = 100/2 + 3000 = 3050.
    const b = getWorldBounds(bbox(0, 0, 10000, 100));
    expect(b.halfWidth).toBe(8000);
    expect(b.halfDepth).toBe(3050);
  });

  it('tiny cities get tiny bounds (no floor; slider always meaningful)', () => {
    // 10-wide bbox. characteristic = 10, 10*0.30 = 3.
    // halfWidth = 10/2 + 3 = 8. Previously a MIN_BUFFER=800 floor kicked in
    // here and broke the slider for small repos; now removed.
    const b = getWorldBounds(bbox(0, 0, 10, 10));
    expect(b.halfWidth).toBe(8);
    expect(b.halfDepth).toBe(8);
  });

  it('cityHeight feeds the characteristic-size calc for tiny-tall cities', () => {
    // 100-wide footprint but a 5000-unit tall building.
    // characteristic = max(100, 100, 5000) = 5000, buffer = 5000*0.30 = 1500.
    // halfWidth = 100/2 + 1500 = 1550.
    const b = getWorldBounds(bbox(0, 0, 100, 100), 5000);
    expect(b.halfWidth).toBe(1550);
    expect(b.halfDepth).toBe(1550);
  });

  it('GROUND_BUFFER_PERCENT slider scales the buffer linearly', () => {
    WORLD.setKey('GROUND_BUFFER_PERCENT', 60);
    // 10000-wide. characteristic = 10000, buffer = 10000*0.60 = 6000.
    // halfWidth = 10000/2 + 6000 = 11000.
    const b = getWorldBounds(bbox(0, 0, 10000, 10000));
    expect(b.halfWidth).toBe(11000);
  });
});
