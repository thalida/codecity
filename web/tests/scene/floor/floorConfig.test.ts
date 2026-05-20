// floorConfig.test.ts — verifies the FLOOR nanostore exposes the keys
// + default values documented in the spec. These defaults are the
// contract between the floor factory and the Controls panel UI.

import { describe, it, expect } from 'vitest';
import { FLOOR } from '@/config/floor.js';

describe('FLOOR', () => {
  it('has the expected keys + defaults', () => {
    const v = FLOOR.get();
    expect(v.ENABLED).toBe(true);
    expect(v.COLOR).toBe('#080515');
    expect(v.SIZE_MULT).toBeCloseTo(0.9);
    expect(v.Y_OFFSET).toBeCloseTo(-0.1);
  });
});
