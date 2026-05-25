// app/tests/config/footprint.test.ts
import { describe, it, expect } from 'vitest';
import { FOOTPRINT } from '@/config/components/footprint.js';

describe('FOOTPRINT', () => {
  it('has the expected keys + defaults', () => {
    const v = FOOTPRINT.get();
    expect(v.ENABLED).toBe(true);
    expect(v.HALO_WIDTH).toBe(24);
    expect(v.CORNER_RADIUS).toBe(2.0);
    expect(v.COLOR).toBe('#0a0b0f');
  });
});
