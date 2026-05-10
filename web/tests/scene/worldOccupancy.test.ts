import { describe, expect, it } from 'vitest';
import { WorldOccupancy } from '@/scene/worldOccupancy';

describe('WorldOccupancy', () => {
  it('scaffold typechecks', () => {
    const occ = new WorldOccupancy();
    expect(occ.size()).toBe(0);
  });
});
