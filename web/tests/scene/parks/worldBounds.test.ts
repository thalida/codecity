import { describe, it, expect } from 'vitest';
import { getWorldBounds } from '@/scene/parks/worldBounds.js';
import type { CityBbox } from '@/types';

function bbox(minX: number, minY: number, maxX: number, maxY: number): CityBbox {
  return {
    minX, minY, maxX, maxY,
    cx: (minX + maxX) / 2, cy: (minY + maxY) / 2,
    width: maxX - minX, depth: maxY - minY,
  };
}

describe('worldBounds', () => {
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
    // bbox is 1000 wide. Buffer = max(200, 1000 * 0.15) = 200.
    // halfWidth = 1000/2 + 200 = 700.
    const b = getWorldBounds(bbox(0, 0, 1000, 1000));
    expect(b.halfWidth).toBe(700);
    expect(b.halfDepth).toBe(700);
  });

  it('buffer scales with the larger bbox dimension', () => {
    // 10000-wide bbox. Buffer = max(200, 10000 * 0.15) = 1500.
    // halfWidth = 10000/2 + 1500 = 6500.
    // halfDepth = 100/2 + 1500 = 1550.
    const b = getWorldBounds(bbox(0, 0, 10000, 100));
    expect(b.halfWidth).toBe(6500);
    expect(b.halfDepth).toBe(1550);
  });

  it('applies minimum buffer for tiny cities', () => {
    // 10-wide bbox. Buffer = max(200, 10 * 0.15) = 200.
    // halfWidth = 10/2 + 200 = 205.
    const b = getWorldBounds(bbox(0, 0, 10, 10));
    expect(b.halfWidth).toBe(205);
    expect(b.halfDepth).toBe(205);
  });
});
