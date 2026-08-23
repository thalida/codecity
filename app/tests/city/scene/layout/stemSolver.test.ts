import { describe, expect, it } from 'vitest';
import { WorldOccupancy, WorldRectKind } from '@/city/scene/layout/occupancyIndex';
import {
  applyFlips,
  computeFlips,
  findSmallestValidStem,
  isMirrorInvariant,
  placeChild,
} from '@/city/scene/layout/stemSolver';
import { StreetAxis } from '@/city/scene/types';

describe('computeFlips', () => {
  it('X-orient parent, side 0, no mirror: flipY only', () => {
    expect(computeFlips(StreetAxis.X, 0, false)).toEqual({ flipX: false, flipY: true });
  });
  it('X-orient parent, side 1, no mirror: no flip', () => {
    expect(computeFlips(StreetAxis.X, 1, false)).toEqual({ flipX: false, flipY: false });
  });
  it('X-orient parent, side 1, mirror: flipX only', () => {
    expect(computeFlips(StreetAxis.X, 1, true)).toEqual({ flipX: true, flipY: false });
  });
  it('X-orient parent, side 0, mirror: both flips', () => {
    expect(computeFlips(StreetAxis.X, 0, true)).toEqual({ flipX: true, flipY: true });
  });
  it('Y-orient parent, side 0, no mirror: flipX only', () => {
    expect(computeFlips(StreetAxis.Y, 0, false)).toEqual({ flipX: true, flipY: false });
  });
  it('Y-orient parent, side 1, mirror: flipY only', () => {
    expect(computeFlips(StreetAxis.Y, 1, true)).toEqual({ flipX: false, flipY: true });
  });
});

describe('applyFlips', () => {
  it('no flips: rect unchanged', () => {
    expect(applyFlips({ x: 10, y: 20, w: 3, d: 4 }, false, false)).toEqual({
      x: 10,
      y: 20,
      w: 3,
      d: 4,
    });
  });
  it('flipX: negates x center, w/d unchanged', () => {
    expect(applyFlips({ x: 10, y: 20, w: 3, d: 4 }, true, false)).toEqual({
      x: -10,
      y: 20,
      w: 3,
      d: 4,
    });
  });
  it('flipY: negates y center, w/d unchanged', () => {
    expect(applyFlips({ x: 10, y: 20, w: 3, d: 4 }, false, true)).toEqual({
      x: 10,
      y: -20,
      w: 3,
      d: 4,
    });
  });
  it('both flips: negates both centers', () => {
    expect(applyFlips({ x: 10, y: 20, w: 3, d: 4 }, true, true)).toEqual({
      x: -10,
      y: -20,
      w: 3,
      d: 4,
    });
  });
});

describe('isMirrorInvariant', () => {
  it('empty list is invariant', () => {
    expect(isMirrorInvariant([], StreetAxis.X)).toBe(true);
  });
  it('single rect on the parent centerline (x=0) is X-mirror-invariant', () => {
    expect(isMirrorInvariant([{ x: 0, y: 10, w: 5, d: 5 }], StreetAxis.X)).toBe(true);
  });
  it('single off-centerline rect is NOT X-mirror-invariant', () => {
    expect(isMirrorInvariant([{ x: 5, y: 10, w: 5, d: 5 }], StreetAxis.X)).toBe(false);
  });
  it('paired off-centerline rects (mirror images) ARE X-mirror-invariant', () => {
    expect(
      isMirrorInvariant(
        [
          { x: 5, y: 10, w: 5, d: 5 },
          { x: -5, y: 10, w: 5, d: 5 },
        ],
        StreetAxis.X
      )
    ).toBe(true);
  });
  it('Y-orient parent: pairs mirrored across Y are invariant', () => {
    expect(
      isMirrorInvariant(
        [
          { x: 10, y: 5, w: 5, d: 5 },
          { x: 10, y: -5, w: 5, d: 5 },
        ],
        StreetAxis.Y
      )
    ).toBe(true);
  });
});

describe('findSmallestValidStem', () => {
  // Helper to build a WorldRect for inserting into occupancy.
  function worldRect(minX: number, minY: number, maxX: number, maxY: number) {
    return {
      minX,
      minY,
      maxX,
      maxY,
      kind: WorldRectKind.Street,
      ref: {} as never,
    };
  }

  it('empty occupancy → returns max(priorStem, originPad)', () => {
    const occ = new WorldOccupancy();
    const childRects = [{ x: 0, y: 10, w: 4, d: 4 }];
    const s = findSmallestValidStem({
      childRects,
      parentOrient: StreetAxis.X,
      side: 1,
      mirror: false,
      parentOriginX: 0,
      parentOriginY: 0,
      priorStem: 50,
      originPad: 30,
      buildingGap: 8,
      streetGap: 8,
      childKind: WorldRectKind.Building,
      occupancy: occ,
    });
    expect(s).toBe(50);
  });

  it('originPad larger than priorStem → returns originPad', () => {
    const occ = new WorldOccupancy();
    const childRects = [{ x: 0, y: 10, w: 4, d: 4 }];
    const s = findSmallestValidStem({
      childRects,
      parentOrient: StreetAxis.X,
      side: 1,
      mirror: false,
      parentOriginX: 0,
      parentOriginY: 0,
      priorStem: 10,
      originPad: 30,
      buildingGap: 8,
      streetGap: 8,
      childKind: WorldRectKind.Building,
      occupancy: occ,
    });
    expect(s).toBe(30);
  });

  it("global rect blocks forward at child rect's perp band → slides past", () => {
    // A blocker at x[50,100] forbids stems in (40, 110): priorStem=50 starts
    // inside it and slides out to 110, where priorStem=0 would gap-fit before.
    const occ = new WorldOccupancy();
    occ.insert(worldRect(50, 8, 100, 12));
    const childRects = [{ x: 0, y: 10, w: 4, d: 4 }];
    const s = findSmallestValidStem({
      childRects,
      parentOrient: StreetAxis.X,
      side: 1,
      mirror: false,
      parentOriginX: 0,
      parentOriginY: 0,
      priorStem: 50,
      originPad: 0,
      buildingGap: 8,
      streetGap: 8,
      childKind: WorldRectKind.Building,
      occupancy: occ,
    });
    expect(s).toBe(110);
  });

  it('global rect at unrelated perp band does NOT constrain', () => {
    // Child rect at perp band [8, 12]. Global rect at perp band [100, 110].
    // Should not affect the slide.
    const occ = new WorldOccupancy();
    occ.insert(worldRect(50, 100, 100, 110));
    const childRects = [{ x: 0, y: 10, w: 4, d: 4 }];
    const s = findSmallestValidStem({
      childRects,
      parentOrient: StreetAxis.X,
      side: 1,
      mirror: false,
      parentOriginX: 0,
      parentOriginY: 0,
      priorStem: 5,
      originPad: 0,
      buildingGap: 8,
      streetGap: 8,
      childKind: WorldRectKind.Building,
      occupancy: occ,
    });
    expect(s).toBe(5);
  });

  it('two global rects with a gap big enough → child fits in the gap', () => {
    // A 4-wide child needs 20 units with padding, and A[0,20]/B[50,100] leave
    // 30: it fits at stem=30, occupying [28,32] inside the gap's [28,42].
    const occ = new WorldOccupancy();
    occ.insert(worldRect(0, 8, 20, 12));
    occ.insert(worldRect(50, 8, 100, 12));
    const childRects = [{ x: 0, y: 10, w: 4, d: 4 }];
    const s = findSmallestValidStem({
      childRects,
      parentOrient: StreetAxis.X,
      side: 1,
      mirror: false,
      parentOriginX: 0,
      parentOriginY: 0,
      priorStem: 0,
      originPad: 0,
      buildingGap: 8,
      streetGap: 8,
      childKind: WorldRectKind.Building,
      occupancy: occ,
    });
    expect(s).toBe(30);
  });

  it('two global rects with a gap too small → slides past both', () => {
    // The same, with a 5-unit gap the 20-wide child cannot use: it slides past
    // B to stem 110.
    const occ = new WorldOccupancy();
    occ.insert(worldRect(0, 8, 20, 12));
    occ.insert(worldRect(25, 8, 100, 12));
    const childRects = [{ x: 0, y: 10, w: 4, d: 4 }];
    const s = findSmallestValidStem({
      childRects,
      parentOrient: StreetAxis.X,
      side: 1,
      mirror: false,
      parentOriginX: 0,
      parentOriginY: 0,
      priorStem: 0,
      originPad: 0,
      buildingGap: 8,
      streetGap: 8,
      childKind: WorldRectKind.Building,
      occupancy: occ,
    });
    expect(s).toBe(110);
  });

  it('multiple child rects at different perps — max constraint applies', () => {
    // Two rects, blocked at 20 and at 60: the further one wins, so stem = 60.
    const occ = new WorldOccupancy();
    occ.insert(worldRect(0, 8, 10, 12));
    occ.insert(worldRect(0, 18, 50, 22));
    const childRects = [
      { x: 0, y: 10, w: 4, d: 4 },
      { x: 0, y: 20, w: 4, d: 4 },
    ];
    const s = findSmallestValidStem({
      childRects,
      parentOrient: StreetAxis.X,
      side: 1,
      mirror: false,
      parentOriginX: 0,
      parentOriginY: 0,
      priorStem: 0,
      originPad: 0,
      buildingGap: 8,
      streetGap: 8,
      childKind: WorldRectKind.Building,
      occupancy: occ,
    });
    expect(s).toBe(60);
  });
});

describe('placeChild', () => {
  function worldRect(minX: number, minY: number, maxX: number, maxY: number) {
    return {
      minX,
      minY,
      maxX,
      maxY,
      kind: WorldRectKind.Street,
      ref: {} as never,
    };
  }

  it('mirror-invariant child (single centered rect) → 2 variants only', () => {
    // Centered rect at x=0 → mirror is a no-op. Only side 0 and side 1 evaluated.
    const occ = new WorldOccupancy();
    const childRects = [{ x: 0, y: 10, w: 4, d: 4 }];
    const result = placeChild({
      childRects,
      parentOrient: StreetAxis.X,
      parentOriginX: 0,
      parentOriginY: 0,
      priorStem: 0,
      originPad: 0,
      buildingGap: 8,
      streetGap: 8,
      childKind: WorldRectKind.Building,
      occupancy: occ,
    });
    // Both sides empty → stem=0, side=0 wins tiebreak.
    expect(result.stem).toBe(0);
    expect(result.side).toBe(0);
    expect(result.mirror).toBe(false);
  });

  it('asymmetric child → all 4 variants evaluated; smaller stem wins', () => {
    const occ = new WorldOccupancy();
    // Insert a blocker on side 1 (+y side, perp band [8, 12]).
    occ.insert(worldRect(0, 8, 20, 12));
    // Child has off-centerline rect → asymmetric.
    const childRects = [{ x: 5, y: 10, w: 4, d: 4 }];
    const result = placeChild({
      childRects,
      parentOrient: StreetAxis.X,
      parentOriginX: 0,
      parentOriginY: 0,
      priorStem: 0,
      originPad: 0,
      buildingGap: 8,
      streetGap: 8,
      childKind: WorldRectKind.Building,
      occupancy: occ,
    });
    // Side 0 (perp y=-10, no blocker) gives stem=0. Side 1 needs to slide past
    // blocker. Side 0 wins.
    expect(result.side).toBe(0);
    expect(result.stem).toBe(0);
  });

  it('tiebreak: equal stems on side 0 and side 1 → side 0 wins', () => {
    const occ = new WorldOccupancy();
    const childRects = [{ x: 0, y: 10, w: 4, d: 4 }]; // mirror-invariant
    const result = placeChild({
      childRects,
      parentOrient: StreetAxis.X,
      parentOriginX: 0,
      parentOriginY: 0,
      priorStem: 0,
      originPad: 0,
      buildingGap: 8,
      streetGap: 8,
      childKind: WorldRectKind.Building,
      occupancy: occ,
    });
    expect(result.side).toBe(0);
  });

  it('tiebreak: equal stems on (side 0 natural) and (side 0 mirror) → natural wins', () => {
    // Asymmetric child where mirror happens to also give stem=0.
    const occ = new WorldOccupancy();
    const childRects = [{ x: 5, y: 10, w: 4, d: 4 }];
    const result = placeChild({
      childRects,
      parentOrient: StreetAxis.X,
      parentOriginX: 0,
      parentOriginY: 0,
      priorStem: 0,
      originPad: 0,
      buildingGap: 8,
      streetGap: 8,
      childKind: WorldRectKind.Building,
      occupancy: occ,
    });
    expect(result.mirror).toBe(false);
  });

  it('deterministic: same inputs → same (stem, side, mirror)', () => {
    const occ = new WorldOccupancy();
    occ.insert(worldRect(0, 8, 20, 12));
    const childRects = [{ x: 5, y: 10, w: 4, d: 4 }];
    const params = {
      childRects,
      parentOrient: StreetAxis.X,
      parentOriginX: 0,
      parentOriginY: 0,
      priorStem: 0,
      originPad: 0,
      buildingGap: 8,
      streetGap: 8,
      childKind: WorldRectKind.Building,
      occupancy: occ,
    };
    const a = placeChild(params);
    const b = placeChild(params);
    expect(a).toEqual(b);
  });

  it('priorStems: per-side floors override priorStem for each variant', () => {
    // A mirror-invariant child takes the side that fits sooner (floor 0, not
    // 50), which a single cross-side floor would deny it.
    const occ = new WorldOccupancy();
    const childRects = [{ x: 0, y: 10, w: 4, d: 4 }];
    const result = placeChild({
      childRects,
      parentOrient: StreetAxis.X,
      parentOriginX: 0,
      parentOriginY: 0,
      priorStem: 50, // fallback; should NOT apply because priorStems takes precedence
      priorStems: [50, 0],
      originPad: 0,
      buildingGap: 8,
      streetGap: 8,
      childKind: WorldRectKind.Building,
      occupancy: occ,
    });
    expect(result.side).toBe(1);
    expect(result.stem).toBe(0);
  });

  it('priorStems: side 0 fits below the cross-side floor when allowed by its own floor', () => {
    // Mirror image of the previous case: priorStems[0]=0, priorStems[1]=50.
    // Side 0 wins at stem=0; side 1 would have been at stem=50.
    const occ = new WorldOccupancy();
    const childRects = [{ x: 0, y: 10, w: 4, d: 4 }];
    const result = placeChild({
      childRects,
      parentOrient: StreetAxis.X,
      parentOriginX: 0,
      parentOriginY: 0,
      priorStem: 50,
      priorStems: [0, 50],
      originPad: 0,
      buildingGap: 8,
      streetGap: 8,
      childKind: WorldRectKind.Building,
      occupancy: occ,
    });
    expect(result.side).toBe(0);
    expect(result.stem).toBe(0);
  });

  it('priorStems omitted: falls back to priorStem on both sides (backward compat)', () => {
    // Without priorStems, both sides are floored at priorStem. Both sides
    // give stem=10; side 0 wins on tiebreak.
    const occ = new WorldOccupancy();
    const childRects = [{ x: 0, y: 10, w: 4, d: 4 }];
    const result = placeChild({
      childRects,
      parentOrient: StreetAxis.X,
      parentOriginX: 0,
      parentOriginY: 0,
      priorStem: 10,
      originPad: 0,
      buildingGap: 8,
      streetGap: 8,
      childKind: WorldRectKind.Building,
      occupancy: occ,
    });
    expect(result.side).toBe(0);
    expect(result.stem).toBe(10);
  });
});
