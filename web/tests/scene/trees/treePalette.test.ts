// treePalette.test.ts — verifies the deterministic tree color picker
// returns values drawn from the live TREES store, that the same seed
// always returns the same color, and that store mutations are reflected.

import { describe, it, expect, beforeEach } from 'vitest';
import { pickTreeGreen } from '@/scene/trees/treePalette.js';
import { TREES } from '@/config/trees.js';

function resetTrees() {
  TREES.setKey('TREE_GREENS', ['#2a6a4a', '#3a7a3a', '#4a8a4a', '#1f5a2f']);
}

describe('treePalette', () => {
  beforeEach(resetTrees);

  it('pickTreeGreen returns a color from TREE_GREENS', () => {
    const greens = TREES.get().TREE_GREENS;
    for (let seed = 0; seed < 50; seed++) {
      expect(greens).toContain(pickTreeGreen(seed));
    }
  });

  it('is deterministic — same seed returns the same color', () => {
    expect(pickTreeGreen(42)).toBe(pickTreeGreen(42));
    expect(pickTreeGreen(7)).toBe(pickTreeGreen(7));
  });

  it('distributes across the palette over many seeds', () => {
    const palette = TREES.get().TREE_GREENS;
    const hits = new Set<string>();
    for (let seed = 0; seed < 500; seed++) hits.add(pickTreeGreen(seed));
    expect(hits.size).toBe(palette.length);
  });

  it('reflects live store mutations', () => {
    TREES.setKey('TREE_GREENS', ['#aabbcc']);
    expect(pickTreeGreen(0)).toBe('#aabbcc');
    expect(pickTreeGreen(1)).toBe('#aabbcc');
  });

  it('returns the only element when the palette is a singleton', () => {
    TREES.setKey('TREE_GREENS', ['#ffffff']);
    expect(pickTreeGreen(0)).toBe('#ffffff');
    expect(pickTreeGreen(123456)).toBe('#ffffff');
  });
});
