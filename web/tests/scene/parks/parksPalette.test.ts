// parksPalette.test.ts — verifies the deterministic palette pickers
// return values drawn from the live PARKS_PALETTE store, that the same
// seed always returns the same color (so the same layout produces the
// same plot composition across reloads), and that store mutations are
// reflected on the next pick.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  pickTreeGreen,
  pickBushNeon,
  pickFlowerColor,
} from '@/scene/parks/parksPalette.js';
import { PARKS_PALETTE } from '@/config/parks.js';

function resetPalette() {
  PARKS_PALETTE.set({
    GROUND_ENABLED: true,
    GROUND_COLOR: '#0c1814',
    TREES_ENABLED: true,
    BUSHES_ENABLED: true,
    FLOWERS_ENABLED: true,
    TREE_GREENS: ['#2a6a4a', '#3a7a3a', '#4a8a4a', '#1f5a2f'],
    TREE_TRUNK_COLOR: '#4a3220',
    BUSH_NEON_COLORS: ['#00ff88', '#ff2bd6', '#b400ff', '#00d9ff', '#ffd400'],
    BUSH_EMISSION_BOOST: 1.5,
    FLOWER_COLORS: ['#ff2bd6', '#ffd400', '#00d9ff', '#00ff88', '#b400ff'],
    FLOWER_EMISSION_BOOST: 1.8,
  });
}

describe('parksPalette pickers', () => {
  beforeEach(resetPalette);

  it('pickTreeGreen returns a color from TREE_GREENS', () => {
    const greens = PARKS_PALETTE.get().TREE_GREENS;
    for (let seed = 0; seed < 50; seed++) {
      expect(greens).toContain(pickTreeGreen(seed));
    }
  });

  it('pickBushNeon returns a color from BUSH_NEON_COLORS', () => {
    const neons = PARKS_PALETTE.get().BUSH_NEON_COLORS;
    for (let seed = 0; seed < 50; seed++) {
      expect(neons).toContain(pickBushNeon(seed));
    }
  });

  it('pickFlowerColor returns a color from FLOWER_COLORS', () => {
    const flowers = PARKS_PALETTE.get().FLOWER_COLORS;
    for (let seed = 0; seed < 50; seed++) {
      expect(flowers).toContain(pickFlowerColor(seed));
    }
  });

  it('is deterministic — same seed returns the same color across calls', () => {
    expect(pickTreeGreen(42)).toBe(pickTreeGreen(42));
    expect(pickBushNeon(7)).toBe(pickBushNeon(7));
    expect(pickFlowerColor(99)).toBe(pickFlowerColor(99));
  });

  it('distributes across the palette over many seeds', () => {
    const palette = PARKS_PALETTE.get().BUSH_NEON_COLORS;
    const hits = new Set<string>();
    for (let seed = 0; seed < 500; seed++) hits.add(pickBushNeon(seed));
    expect(hits.size).toBe(palette.length);
  });

  it('reflects live store mutations', () => {
    PARKS_PALETTE.setKey('TREE_GREENS', ['#aabbcc']);
    expect(pickTreeGreen(0)).toBe('#aabbcc');
    expect(pickTreeGreen(1)).toBe('#aabbcc');
  });

  it('returns the only element when the palette is a singleton', () => {
    PARKS_PALETTE.setKey('BUSH_NEON_COLORS', ['#ffffff']);
    expect(pickBushNeon(0)).toBe('#ffffff');
    expect(pickBushNeon(123456)).toBe('#ffffff');
  });
});
