// layoutV4-trace.test.ts — exercise the optional `trace` params on
// findSmallestValidStem, placeChild, and the layoutCityV4WithTrace entry.

import { describe, it, expect } from 'vitest';
import {
  findSmallestValidStem,
  placeChild,
  // layoutCityV4WithTrace,   // arrives in Task 3
} from '@/scene/layoutV4.js';
import type {
  VariantTrace,
  // StemPlacementTrace,      // arrives in Task 3
} from '@/scene/layoutV4.js';
import { WorldOccupancy } from '@/scene/worldOccupancy.js';
import { StreetAxis } from '@/types';

describe('findSmallestValidStem with trace', () => {
  it('no obstacles — stem at baseline, no forbidden intervals, no binding', () => {
    const occupancy = new WorldOccupancy();
    const trace: VariantTrace = {
      side: 0, mirror: false, stem: 0,
      forbidden: [], bindingIndex: null,
    };
    const stem = findSmallestValidStem(
      {
        childRects: [{ x: 0, y: 0, w: 2, d: 2 }],
        parentOrient: StreetAxis.X,
        side: 0, mirror: false,
        parentOriginX: 0, parentOriginY: 0,
        priorStem: 0, originPad: 5, childGap: 1,
        occupancy,
      },
      trace,
    );
    expect(stem).toBe(5);
    expect(trace.stem).toBe(5);
    expect(trace.forbidden).toEqual([]);
    expect(trace.bindingIndex).toBe(null);
  });

  it('one obstacle in perp band — interval recorded, binding null when baseline already in gap', () => {
    const occupancy = new WorldOccupancy();
    // Obstacle: a building rect at along [10, 14], perp [-1, 1].
    const obstacle = {
      minX: 10, maxX: 14, minY: -1, maxY: 1,
      kind: 'building' as const,
      ref: { x: 12, y: 0, w: 4, d: 2 } as never,
    };
    occupancy.insert(obstacle);
    const trace: VariantTrace = {
      side: 0, mirror: false, stem: 0,
      forbidden: [], bindingIndex: null,
    };
    const stem = findSmallestValidStem(
      {
        childRects: [{ x: 0, y: 0, w: 2, d: 2 }],   // perp [-1, 1] — overlaps
        parentOrient: StreetAxis.X,
        side: 0, mirror: false,
        parentOriginX: 0, parentOriginY: 0,
        priorStem: 0, originPad: 5, childGap: 1,
        occupancy,
      },
      trace,
    );
    // baseline = 5. Forbidden interval: (10 - 1 - 1, 14 + 1 + 1) = (8, 16).
    // s=5 < lower=8 → return 5; no jump.
    expect(stem).toBe(5);
    expect(trace.forbidden).toHaveLength(1);
    expect(trace.forbidden[0].obstacle).toBe(obstacle);
    expect(trace.forbidden[0].fromChildRectIndex).toBe(0);
    expect(trace.bindingIndex).toBe(null);
  });

  it('obstacle forces jump — bindingIndex points to the interval that set the stem', () => {
    const occupancy = new WorldOccupancy();
    const obstacle = {
      minX: 4, maxX: 10, minY: -1, maxY: 1,
      kind: 'building' as const,
      ref: { x: 7, y: 0, w: 6, d: 2 } as never,
    };
    occupancy.insert(obstacle);
    const trace: VariantTrace = {
      side: 0, mirror: false, stem: 0,
      forbidden: [], bindingIndex: null,
    };
    const stem = findSmallestValidStem(
      {
        childRects: [{ x: 0, y: 0, w: 2, d: 2 }],
        parentOrient: StreetAxis.X,
        side: 0, mirror: false,
        parentOriginX: 0, parentOriginY: 0,
        priorStem: 0, originPad: 5, childGap: 1,
        occupancy,
      },
      trace,
    );
    // baseline=5. Forbidden: (4 - 1 - 1, 10 + 1 + 1) = (2, 12).
    // s=5 inside, jump to 12.
    expect(stem).toBe(12);
    expect(trace.forbidden).toHaveLength(1);
    expect(trace.bindingIndex).toBe(0);
  });
});
