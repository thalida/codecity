import { describe, it, expect } from 'vitest';

import { rectOfBuilding, rectOfStreet, _rectsOverlap } from '@/city/scene/layout/rect';
import { StreetAxis } from '@/city/scene/types';
import type { Building, Street } from '@/city/scene/types';

// Minimal fixtures: the helpers only read geometry fields, so cast through
// unknown rather than constructing full Building/Street instances.
function makeStreet(orientation: StreetAxis): Street {
  return { x: 10, y: -4, width: 3, length: 50, orientation } as unknown as Street;
}

describe('rectOfStreet()', () => {
  it('puts length on x and width on y for an X-oriented street', () => {
    expect(rectOfStreet(makeStreet(StreetAxis.X))).toEqual({ x: 10, y: -4, w: 50, d: 3 });
  });

  it('puts width on x and length on y for a Y-oriented street', () => {
    expect(rectOfStreet(makeStreet(StreetAxis.Y))).toEqual({ x: 10, y: -4, w: 3, d: 50 });
  });
});

describe('rectOfBuilding()', () => {
  it('maps center + extents directly', () => {
    const b = { x: 1, y: 2, w: 4, d: 6 } as unknown as Building;
    expect(rectOfBuilding(b)).toEqual({ x: 1, y: 2, w: 4, d: 6 });
  });
});

// The packer needs abutment to read as non-overlapping, so the touching cases
// carry as much weight as the intersecting ones.
describe('_rectsOverlap()', () => {
  const A = { x: 0, y: 0, w: 10, d: 10 };
  it.each([
    ['intersecting', { x: 5, y: 5, w: 10, d: 10 }, true],
    ['disjoint', { x: 100, y: 0, w: 10, d: 10 }, false],
    ['touching on x', { x: 10, y: 0, w: 10, d: 10 }, false],
    ['touching on y', { x: 0, y: 10, w: 10, d: 10 }, false],
    ['contained', { x: 0, y: 0, w: 5, d: 5 }, true],
  ])('%s → %s', (_label, b, expected) => {
    expect(_rectsOverlap(A, b)).toBe(expected);
  });

  // Translating touching rects through non-integer offsets lands here.
  it('treats a sub-femto overlap as touching', () => {
    expect(_rectsOverlap({ x: 0, y: 0, w: 2, d: 2 }, { x: 2 - 7e-15, y: 0, w: 2, d: 2 })).toBe(
      false
    );
  });
});
