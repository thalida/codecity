import { describe, expect, it } from 'vitest';
import { WorldRectKind } from '@/scene/layout/worldOccupancy.js';
import { StreetAxis } from '@/types';
import {
  applyFlips,
  computeFlips,
  isMirrorInvariant,
  translateRectsToWorld,
} from '@/scene/layout/layout';

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

import { WorldOccupancy } from '@/scene/layout/worldOccupancy';
import { findSmallestValidStem } from '@/scene/layout/layout';

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
      childGap: 8,
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
      childGap: 8,
      occupancy: occ,
    });
    expect(s).toBe(30);
  });

  it("global rect blocks forward at child rect's perp band → slides past", () => {
    // X-orient parent. Child rect at child-local (0, 10), w=4, d=4.
    // After side=1 (no flips), it sits at world (stem, 10), perp band [8, 12].
    // Insert a global rect at world x in [50, 100], y in [8, 12].
    //
    // Forbidden interval: lower = 50 - 2 - 8 = 40, upper = 100 - (-2) + 8 = 110.
    // priorStem=50 puts s inside (40, 110) from the start → algorithm advances to 110.
    //
    // (Note: priorStem=0 would return 0 because the child at x=[-2,2] is before
    //  the global rect at [50,100] and doesn't overlap — that's the gap-fit
    //  placing the child in the empty space before the blocker. To exercise the
    //  "slides past" path we must start s inside the forbidden interval.)
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
      childGap: 8,
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
      childGap: 8,
      occupancy: occ,
    });
    expect(s).toBe(5);
  });

  it('two global rects with a gap big enough → child fits in the gap', () => {
    // X-orient parent. Child rect at child-local (0, 10), w=4, d=4 — 4 units wide.
    // Global rect A at world x in [0, 20], y in [8, 12].
    // Global rect B at world x in [50, 100], y in [8, 12].
    // Gap between A and B: x in [20, 50], i.e. 30 units. Child needs 4 + 2*gap = 20.
    // At priorStem=0: child's alongMin at stem=0 = -2. To fit after A: stem ≥ 20 - (-2) + gap = 30.
    //   At stem=30: child x range [28, 32] — fits in gap [20+8, 50-8] = [28, 42]. ✓
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
      childGap: 8,
      occupancy: occ,
    });
    expect(s).toBe(30);
  });

  it('two global rects with a gap too small → slides past both', () => {
    // Same as above but A in [0, 20] and B in [25, 100] — gap only 5 units.
    // Child (4 wide + 16 padding = 20) cannot fit. Must slide past B.
    // After B at x=100: stem = 100 - (-2) + gap = 102 + 8 = 110.
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
      childGap: 8,
      occupancy: occ,
    });
    expect(s).toBe(110);
  });

  it('multiple child rects at different perps — max constraint applies', () => {
    // Child has two rects: r1 at perp y=10, r2 at perp y=20.
    // r1 blocked by global at x [0,10] in y [8,12] → needs stem ≥ 10+gap-(-2) = 20.
    // r2 blocked by global at x [0,50] in y [18,22] → needs stem ≥ 50+gap-(-2) = 60.
    // Max applies: stem = 60.
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
      childGap: 8,
      occupancy: occ,
    });
    expect(s).toBe(60);
  });
});

import { placeChild } from '@/scene/layout/layout';

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
      childGap: 8,
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
      childGap: 8,
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
      childGap: 8,
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
      childGap: 8,
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
      childGap: 8,
      occupancy: occ,
    };
    const a = placeChild(params);
    const b = placeChild(params);
    expect(a).toEqual(b);
  });

  it('priorStems: per-side floors override priorStem for each variant', () => {
    // priorStems[0]=50, priorStems[1]=0. A mirror-invariant child should
    // prefer side 1 (floor 0) over side 0 (floor 50) since side 1 fits
    // sooner. Without per-side, the cross-side floor of 50 would force
    // both sides to start at 50.
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
      childGap: 8,
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
      childGap: 8,
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
      childGap: 8,
      occupancy: occ,
    });
    expect(result.side).toBe(0);
    expect(result.stem).toBe(10);
  });
});

describe('translateRectsToWorld', () => {
  it('no flips, stem=0 → identity translation around origin', () => {
    const child = { x: 5, y: 10, w: 4, d: 4 };
    const world = translateRectsToWorld(
      [child],
      StreetAxis.X,
      0,
      0, // parent origin
      0, // stem
      1, // side
      false // mirror
    );
    expect(world).toHaveLength(1);
    // After: world.x = child.x + parentOriginX + stem = 5; world.y = child.y + parentOriginY = 10.
    expect(world[0].minX).toBe(3);
    expect(world[0].maxX).toBe(7);
    expect(world[0].minY).toBe(8);
    expect(world[0].maxY).toBe(12);
  });

  it('X-orient parent, side 0, stem=10 → flipY + alongShift', () => {
    const child = { x: 5, y: 10, w: 4, d: 4 };
    const world = translateRectsToWorld([child], StreetAxis.X, 0, 0, 10, 0, false);
    // For X-orient parent, side=0 → flipY=true. World y = -child.y + parentOriginY = -10.
    // World x = child.x + parentOriginX + stem = 5 + 10 = 15.
    expect(world[0].minX).toBe(13);
    expect(world[0].maxX).toBe(17);
    expect(world[0].minY).toBe(-12);
    expect(world[0].maxY).toBe(-8);
  });

  it('X-orient parent, side 1, mirror=true → flipX, no flipY, alongShift', () => {
    const child = { x: 5, y: 10, w: 4, d: 4 };
    const world = translateRectsToWorld([child], StreetAxis.X, 0, 0, 10, 1, true);
    // For X-orient parent, mirror → flipX=true. World x = -child.x + parentOriginX + stem = -5 + 10 = 5.
    // World y = child.y = 10.
    expect(world[0].minX).toBe(3);
    expect(world[0].maxX).toBe(7);
    expect(world[0].minY).toBe(8);
    expect(world[0].maxY).toBe(12);
  });

  it('Y-orient parent, side 0, stem=10 → flipX + alongShift', () => {
    const child = { x: 5, y: 10, w: 4, d: 4 };
    const world = translateRectsToWorld([child], StreetAxis.Y, 0, 0, 10, 0, false);
    // For Y-orient parent: along=Y, perp=X. side=0 → flipX=true.
    // World x = -child.x + parentOriginX = -5. World y = child.y + parentOriginY + stem = 10 + 10 = 20.
    expect(world[0].minX).toBe(-7);
    expect(world[0].maxX).toBe(-3);
    expect(world[0].minY).toBe(18);
    expect(world[0].maxY).toBe(22);
  });

  it('preserves kind and ref from original rects', () => {
    // translateRectsToWorld expects {x,y,w,d,kind,ref} input form for typed rects.
    // We pass a stub ref to verify it's preserved.
    const ref = { id: 'stub' } as unknown as never;
    const child = { x: 0, y: 10, w: 4, d: 4, kind: WorldRectKind.Building, ref };
    const world = translateRectsToWorld([child], StreetAxis.X, 0, 0, 0, 1, false);
    expect(world[0].kind).toBe('building');
    expect(world[0].ref).toBe(ref);
  });
});

import { estimateDirReaches, layoutCity } from '@/scene/layout/layout';
import { NodeKind } from '@/types';
import {
  assertNoOverlap,
  assertStemOrder,
  assertTreeRespecting,
  assertTJunctionsValid,
} from '../_helpers/layoutAsserts';
import { mkFile, mkDir } from '../_helpers/cityFixtures';

describe('layoutCity end-to-end', () => {
  it('lays out a minimal tree with all four invariants satisfied', () => {
    const tree = mkDir('root', [
      mkFile('a.ts'),
      mkFile('b.ts'),
      mkDir('sub', [mkFile('c.ts'), mkFile('d.ts')]),
    ]);
    const layout = layoutCity({ tree });
    expect(() => assertNoOverlap(layout)).not.toThrow();
    expect(() => assertStemOrder(layout)).not.toThrow();
    expect(() => assertTreeRespecting(layout)).not.toThrow();
    expect(() => assertTJunctionsValid(layout)).not.toThrow();
  });

  // estimateDirReaches: bottom-up pre-pass that sizes the phantom in each
  // child recursion. Must approximate (or upper-bound) the actual placement's
  // along/perp extents — undersizing the phantom reintroduces the
  // grandchild-overlaps-ancestor bug.
  describe('estimateDirReaches matches actual layout', () => {
    it('flat tree: estimated alongReach >= actual road length', () => {
      const tree = mkDir('root', [
        mkFile('a.ts'),
        mkFile('b.ts'),
        mkFile('c.ts'),
        mkFile('d.ts'),
        mkFile('e.ts'),
      ]);
      const stats = { lines: { min: 20, max: 20 }, bytes: { min: 500, max: 500 } };
      const cache = new Map();
      const reaches = estimateDirReaches(tree, stats.lines, stats.bytes, undefined, cache);
      const layout = layoutCity({ tree });
      const root = layout.streets.find((s: any) => s.dir?.name === 'root');
      expect(root).toBeDefined();
      // The estimate must be at least as large as the actual road length —
      // if it's smaller, the phantom under-sizes and the bug returns.
      expect(reaches.alongReach).toBeGreaterThanOrEqual(root!.length - 1);
    });

    it("nested tree: every dir's estimate >= actual road length", () => {
      const tree = mkDir('root', [
        mkDir('a', [mkFile('a1.ts'), mkFile('a2.ts'), mkFile('a3.ts')]),
        mkDir('b', [mkFile('b1.ts'), mkFile('b2.ts')]),
        mkDir('c', [
          mkDir('cc', [mkFile('cc1.ts'), mkFile('cc2.ts'), mkFile('cc3.ts')]),
          mkFile('c1.ts'),
        ]),
      ]);
      const stats = { lines: { min: 20, max: 20 }, bytes: { min: 500, max: 500 } };
      const cache = new Map();
      estimateDirReaches(tree, stats.lines, stats.bytes, undefined, cache);
      const layout = layoutCity({ tree });

      const mismatches: string[] = [];
      for (const street of layout.streets) {
        if (!street.dir) continue;
        const est = cache.get(street.dir as any);
        if (!est) continue;
        if (est.alongReach < street.length - 1) {
          mismatches.push(`${street.dir.name}: est=${est.alongReach}, actual=${street.length}`);
        }
      }
      expect(mismatches).toEqual([]);
    });

    it('deep chain: subdir contributions correctly propagate', () => {
      // root → a → aa → aaa with files at the deepest level.
      const tree = mkDir('root', [
        mkDir('a', [mkDir('aa', [mkDir('aaa', [mkFile('x.ts'), mkFile('y.ts'), mkFile('z.ts')])])]),
      ]);
      const stats = { lines: { min: 20, max: 20 }, bytes: { min: 500, max: 500 } };
      const cache = new Map();
      estimateDirReaches(tree, stats.lines, stats.bytes, undefined, cache);
      const layout = layoutCity({ tree });
      // Every street's length should be covered by its dir's estimate.
      for (const street of layout.streets) {
        if (!street.dir) continue;
        const est = cache.get(street.dir as any);
        if (!est) continue;
        expect(est.alongReach).toBeGreaterThanOrEqual(street.length - 1);
      }
    });
  });

  // Stress test that mirrors the firecrawl/Linux-scale shape: a long-road
  // ancestor (apps) whose alphabetically-first child (api) has a deep
  // subtree extending along the ancestor's road. Before the
  // estimateDirAlongReach fix, the phantom seeded into api's local occupancy
  // was sized with parentMaxBoundary*2 + 1000 at recursion start (when api
  // was apps' first child, parentMaxBoundary was tiny); deep grandchildren
  // placed past the phantom could land on top of apps' trunk.
  it('long-road ancestor body does not overlap deep grandchildren in first-alpha subtree', () => {
    function mkSizedFile(name: string, sizeBytes: number, lines: number): any {
      return {
        name,
        type: NodeKind.File,
        path: name,
        extension: '.ts',
        size: sizeBytes,
        lines,
        created: '2024-01-01T00:00:00Z',
        modified: '2024-01-01T00:00:00Z',
      };
    }
    function manyVariedFiles(prefix: string, count: number): any[] {
      return Array.from({ length: count }, (_, i) => {
        const size = 100 + (i % 5) * 5000 + ((i * 37) % 50000);
        const lines = 10 + (i % 100);
        return mkSizedFile(`${prefix}${String(i).padStart(3, '0')}.ts`, size, lines);
      });
    }
    const tree = mkDir('root', [
      mkDir('apps', [
        mkDir('api', [
          mkDir('src', [
            ...manyVariedFiles('a_', 25),
            ...manyVariedFiles('b_', 25),
            ...manyVariedFiles('c_', 25),
            mkDir('services', [
              ...manyVariedFiles('svc_', 60),
              mkDir('subscription', manyVariedFiles('sub_', 8)),
              mkDir('webhook', manyVariedFiles('wh_', 8)),
            ]),
          ]),
        ]),
        ...Array.from({ length: 10 }, (_, i) => {
          const name = `sdk${String.fromCharCode('b'.charCodeAt(0) + i)}`;
          return mkDir(name, [
            mkDir('src', manyVariedFiles(`${name}_src_`, 40)),
            mkDir('lib', manyVariedFiles(`${name}_lib_`, 40)),
            ...manyVariedFiles(`${name}_root_`, 20),
          ]);
        }),
      ]),
    ]);
    const layout = layoutCity({ tree });
    const apps = layout.streets.find((s) => s.dir?.name === 'apps');
    expect(apps).toBeDefined();
    // Sanity: apps' trunk should be long enough that any phantom-too-short
    // bug would surface (apps must extend well past the original
    // parentMaxBoundary*2 + 1000 ≈ 1000 reach).
    expect(apps!.length).toBeGreaterThan(2000);
    expect(() => assertNoOverlap(layout)).not.toThrow();
  });
});
