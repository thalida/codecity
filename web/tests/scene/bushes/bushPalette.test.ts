// bushPalette.test.ts — verifies the deterministic bush color picker.

import { describe, it, expect, beforeEach } from 'vitest';
import { pickBushNeon } from '@/scene/components/bushes/bushPalette.js';
import { BUSHES } from '@/config/bushes.js';

function resetBushes() {
  BUSHES.setKey('BUSH_NEON_COLORS', ['#00ff88', '#ff2bd6', '#b400ff', '#00d9ff', '#ffd400']);
}

describe('bushPalette', () => {
  beforeEach(resetBushes);

  it('pickBushNeon returns a color from BUSH_NEON_COLORS', () => {
    const neons = BUSHES.get().BUSH_NEON_COLORS;
    for (let seed = 0; seed < 50; seed++) {
      expect(neons).toContain(pickBushNeon(seed));
    }
  });

  it('is deterministic — same seed returns the same color', () => {
    expect(pickBushNeon(7)).toBe(pickBushNeon(7));
  });

  it('distributes across the palette over many seeds', () => {
    const palette = BUSHES.get().BUSH_NEON_COLORS;
    const hits = new Set<string>();
    for (let seed = 0; seed < 500; seed++) hits.add(pickBushNeon(seed));
    expect(hits.size).toBe(palette.length);
  });

  it('reflects live store mutations', () => {
    BUSHES.setKey('BUSH_NEON_COLORS', ['#aabbcc']);
    expect(pickBushNeon(0)).toBe('#aabbcc');
  });

  it('returns the only element when the palette is a singleton', () => {
    BUSHES.setKey('BUSH_NEON_COLORS', ['#ffffff']);
    expect(pickBushNeon(0)).toBe('#ffffff');
    expect(pickBushNeon(123456)).toBe('#ffffff');
  });
});
