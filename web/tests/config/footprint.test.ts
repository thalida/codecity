// web/tests/config/footprint.test.ts
import { describe, it, expect } from 'vitest';
import { FOOTPRINT } from '@/config/footprint.js';

describe('FOOTPRINT', () => {
  it('has the expected keys + defaults', () => {
    const v = FOOTPRINT.get();
    expect(v.ENABLED).toBe(true);
    expect(v.HALO_WIDTH).toBe(64);
    expect(v.CORNER_RADIUS).toBe(24);
    expect(v.COLOR).toBe('#0a0b0f');
  });
});
