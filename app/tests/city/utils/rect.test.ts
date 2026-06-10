// rect.test.ts — verifies the canonical Street/Building → layout-plane Rect
// mapping (the orientation swap every consumer used to re-derive inline).

import { describe, it, expect } from 'vitest';

import { rectOfBuilding, rectOfStreet } from '@/city/utils/rect';
import { StreetAxis } from '@/types';
import type { Building, Street } from '@/types';

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
