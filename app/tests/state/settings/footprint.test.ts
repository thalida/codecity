// app/tests/config/footprint.test.ts
import { describe, it, expect } from 'vitest';
import { FOOTPRINT } from '@/state/settings/footprint';

describe('FOOTPRINT', () => {
  it('exposes the expected keys with the right types', () => {
    // Asserting shape, not specific values — tuning the production
    // defaults shouldn't break this test.
    const v = FOOTPRINT.value;
    expect(typeof v.ENABLED).toBe('boolean');
    expect(typeof v.HALO_WIDTH).toBe('number');
    expect(typeof v.CORNER_RADIUS).toBe('number');
    expect(v.COLOR).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
