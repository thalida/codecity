// Tests for _backwardPackChildren — the post-pass that clusters
// alphabetically-adjacent siblings against each other to close stranded-
// island gaps.

import { describe, expect, it } from 'vitest';
import { StreetAxis } from '@/types';
import type { Building, Street } from '@/types';
import { WorldOccupancy, type WorldRect } from '@/scene/worldOccupancy';
import {
  _backwardPackChildren,
  type ChildPlacementInfo,
} from '@/scene/layoutV4';

// ─── Helpers ───────────────────────────────────────────────────────────────

// makeBuildingRect: wraps a Building-shaped ref with a WorldRect aligned to
// its bounds. Mutating the rect's min/max OR the ref's x/y must keep them in
// sync — that's exactly the invariant _backwardPackChildren relies on.
function makeBuildingRect(x: number, y: number, w: number, d: number): {
  rect: WorldRect;
  ref: Building;
} {
  const ref: Building = {
    x, y, w, d,
    h: 1, floors: 1,
    file: null as unknown as Building['file'],
    color: null as unknown as string,
    orient: 0 as unknown as Building['orient'],
  };
  const rect: WorldRect = {
    minX: x - w / 2,
    minY: y - d / 2,
    maxX: x + w / 2,
    maxY: y + d / 2,
    kind: 'building',
    ref,
  };
  return { rect, ref };
}

// placementOf: build a ChildPlacementInfo from a single building.
function placementOf(stem: number, rect: WorldRect): ChildPlacementInfo {
  return { stem, subtreeRects: [rect] };
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('_backwardPackChildren', () => {
  it('no-op when fewer than 2 placements', () => {
    const occupancy = new WorldOccupancy();
    const { rect } = makeBuildingRect(0, 5, 10, 4);
    occupancy.insert(rect);
    const placements: ChildPlacementInfo[] = [placementOf(0, rect)];
    _backwardPackChildren(placements, StreetAxis.X, occupancy, 1);
    expect(placements[0].stem).toBe(0);
    expect(rect.minX).toBe(-5);
  });

  it('last placement never moves; earlier placements shift forward', () => {
    // X-orient parent road. Two side-by-side buildings on the SAME perp band
    // (y=5, depth 4). V4 placed A at stem 0 and B at stem 100, leaving a
    // 90-wide gap (more than they need). Post-pass should shift A forward
    // until A's far edge is childGap=1 away from B's near edge (95). A's
    // maxX → 94 → center → 89.
    const occupancy = new WorldOccupancy();
    const { rect: aRect, ref: aRef } = makeBuildingRect(0, 5, 10, 4);
    const { rect: bRect, ref: bRef } = makeBuildingRect(100, 5, 10, 4);
    occupancy.insert(aRect);
    occupancy.insert(bRect);
    const placements: ChildPlacementInfo[] = [
      placementOf(0, aRect),
      placementOf(100, bRect),
    ];
    _backwardPackChildren(placements, StreetAxis.X, occupancy, 1);
    expect(bRef.x).toBe(100);
    expect(aRef.x).toBeCloseTo(89, 6);
    expect(placements[0].stem).toBeCloseTo(89, 6);
    expect(aRect.minX).toBeCloseTo(84, 6);
    expect(aRect.maxX).toBeCloseTo(94, 6);
  });

  it('a non-overlapping perp band does not block the forward shift', () => {
    // Same setup as above but B is on a DIFFERENT perp band (y=-20). A's
    // perp band is y=5 (depth 4 → [3, 7]); B's perp band is y=-20 (depth 4 →
    // [-22, -18]). No overlap. So B does NOT constrain A's forward shift.
    //
    // With nothing to clear, A could shift to +Infinity. The algorithm
    // detects no forward obstacle and leaves A in place (maxShift stays
    // Infinity, code skips the mutation).
    const occupancy = new WorldOccupancy();
    const { rect: aRect, ref: aRef } = makeBuildingRect(0, 5, 10, 4);
    const { rect: bRect } = makeBuildingRect(100, -20, 10, 4);
    occupancy.insert(aRect);
    occupancy.insert(bRect);
    const placements: ChildPlacementInfo[] = [
      placementOf(0, aRect),
      placementOf(100, bRect),
    ];
    _backwardPackChildren(placements, StreetAxis.X, occupancy, 1);
    expect(aRef.x).toBe(0);
    expect(placements[0].stem).toBe(0);
  });

  it('cascade: each earlier child packs against the prior (now-shifted) sibling', () => {
    // Three siblings A, B, C at stems 0, 50, 200, all on the same perp band.
    // Walk reverse: C stays; B shifts forward against C; A shifts forward
    // against B's new position. End state: all three tightly packed.
    // childGap=2. Centers: C=200, B.maxX→193 → B center=188; A.maxX→181 →
    // A center=176.
    const occupancy = new WorldOccupancy();
    const { rect: aRect, ref: aRef } = makeBuildingRect(0, 5, 10, 4);
    const { rect: bRect, ref: bRef } = makeBuildingRect(50, 5, 10, 4);
    const { rect: cRect, ref: cRef } = makeBuildingRect(200, 5, 10, 4);
    occupancy.insert(aRect);
    occupancy.insert(bRect);
    occupancy.insert(cRect);
    const placements: ChildPlacementInfo[] = [
      placementOf(0, aRect),
      placementOf(50, bRect),
      placementOf(200, cRect),
    ];
    _backwardPackChildren(placements, StreetAxis.X, occupancy, 2);
    expect(cRef.x).toBe(200);
    // B.maxX → 200-5-2 = 193. B.x = 188.
    expect(bRef.x).toBeCloseTo(188, 6);
    // A.maxX → 188-5-2 = 181. A.x = 176.
    expect(aRef.x).toBeCloseTo(176, 6);
  });

  it('Y-orient parent: shift happens along Y, not X', () => {
    // Parent road is Y-orient; along axis is Y. Two siblings on the SAME
    // perp band (x=5). A's far edge → 100-5-1 = 94 → A.y = 89.
    const occupancy = new WorldOccupancy();
    const { rect: aRect, ref: aRef } = makeBuildingRect(5, 0, 4, 10);
    const { rect: bRect, ref: bRef } = makeBuildingRect(5, 100, 4, 10);
    occupancy.insert(aRect);
    occupancy.insert(bRect);
    _backwardPackChildren(
      [placementOf(0, aRect), placementOf(100, bRect)],
      StreetAxis.Y,
      occupancy,
      1,
    );
    expect(bRef.y).toBe(100);
    expect(aRef.y).toBeCloseTo(89, 6);
    expect(aRef.x).toBe(5);
  });

  it('moves the underlying ref so the renderer sees the shifted position', () => {
    // Mutating .x / .y on the ref is critical: the renderer reads from
    // CityLayout.buildings, and that same ref is the one we mutate. This
    // test pins that contract explicitly.
    const occupancy = new WorldOccupancy();
    const { rect: aRect, ref: aRef } = makeBuildingRect(0, 5, 10, 4);
    const { rect: bRect } = makeBuildingRect(50, 5, 10, 4);
    occupancy.insert(aRect);
    occupancy.insert(bRect);
    const placements: ChildPlacementInfo[] = [
      placementOf(0, aRect),
      placementOf(50, bRect),
    ];
    const refBefore = aRef;
    _backwardPackChildren(placements, StreetAxis.X, occupancy, 1);
    // Same object identity — we did not replace it.
    expect(aRef).toBe(refBefore);
    expect(aRef.x).not.toBe(0);
    // Rect and ref agree on the new position.
    expect(aRect.minX).toBeCloseTo(aRef.x - aRef.w / 2, 6);
  });

  it('shifted rects are re-inserted, so subsequent queries find them in their new location', () => {
    // After the post-pass, occupancy must reflect new positions. Query the
    // old location → should be empty. Query the new location → should find
    // the shifted rect.
    const occupancy = new WorldOccupancy();
    const { rect: aRect } = makeBuildingRect(0, 5, 10, 4);
    const { rect: bRect } = makeBuildingRect(100, 5, 10, 4);
    occupancy.insert(aRect);
    occupancy.insert(bRect);
    _backwardPackChildren(
      [placementOf(0, aRect), placementOf(100, bRect)],
      StreetAxis.X,
      occupancy,
      1,
    );
    // Old A position (around x=0) should now be empty.
    const oldHits = occupancy.query(-6, 0, -4, 10);
    expect(oldHits.length).toBe(0);
    // New A position (around x=94) should find A.
    const newHits = occupancy.query(93, 0, 95, 10);
    expect(newHits.length).toBe(1);
    expect(newHits[0]).toBe(aRect);
  });

  it('respects childGap when computing the shift limit', () => {
    // Same as the basic two-sibling case but with a different childGap. The
    // resulting spacing should track childGap.
    const occupancy = new WorldOccupancy();
    const { rect: aRect, ref: aRef } = makeBuildingRect(0, 5, 10, 4);
    const { rect: bRect, ref: bRef } = makeBuildingRect(100, 5, 10, 4);
    occupancy.insert(aRect);
    occupancy.insert(bRect);
    _backwardPackChildren(
      [placementOf(0, aRect), placementOf(100, bRect)],
      StreetAxis.X,
      occupancy,
      5,
    );
    // A's far edge → 100 - 5 - 5 = 90 → A center = 85.
    expect(aRef.x).toBeCloseTo(85, 6);
    expect(bRef.x).toBe(100);
  });

  it('subtree with multiple rects: shift is bounded by the most-constrained rect', () => {
    // A's "subtree" has two rects at different perp bands. The forward
    // constraint applies independently per rect; the overall shift is the
    // minimum allowable across all rects. nearObstacle limits a1's shift,
    // farObstacle limits a2's; min wins.
    const occupancy = new WorldOccupancy();
    // a1 at (x=0, y=5, w=10) → maxX=5. Near obstacle at (50,5,10) → minX=45.
    //   shift limit = 45-5-1 = 39.
    // a2 at (x=0, y=-5, w=10) → maxX=5. Far obstacle at (200,-5,10) → minX=195.
    //   shift limit = 195-5-1 = 189.
    // min → 39.
    const { rect: a1, ref: a1Ref } = makeBuildingRect(0, 5, 10, 4);
    const { rect: a2, ref: a2Ref } = makeBuildingRect(0, -5, 10, 4);
    const { rect: nearObstacle } = makeBuildingRect(50, 5, 10, 4);
    const { rect: farObstacle } = makeBuildingRect(200, -5, 10, 4);
    occupancy.insert(a1);
    occupancy.insert(a2);
    occupancy.insert(nearObstacle);
    occupancy.insert(farObstacle);
    const placements: ChildPlacementInfo[] = [
      { stem: 0, subtreeRects: [a1, a2] },
      { stem: 100, subtreeRects: [nearObstacle, farObstacle] },
    ];
    _backwardPackChildren(placements, StreetAxis.X, occupancy, 1);
    expect(a1Ref.x).toBeCloseTo(39, 6);
    expect(a2Ref.x).toBeCloseTo(39, 6);
  });
});

// ─── Integration: end-to-end through layoutCityV4 ──────────────────────────

import { layoutCityV4 } from '@/scene/layoutV4';
import { NodeKind } from '@/types';
import {
  assertNoOverlap,
  assertStemOrder,
  assertTreeRespecting,
  assertTJunctionsValid,
} from './layout.test';

describe('layoutCityV4 with backward-pack: invariants', () => {
  function mkFile(name: string): any {
    return {
      name, type: NodeKind.File, path: name, extension: '.ts',
      size: 500, lines: 20,
      created: '2024-01-01T00:00:00Z', modified: '2024-01-01T00:00:00Z',
    };
  }
  // mkDir — recursively re-prefixes every descendant's path with the parent's
  // path. The existing V4 test's mkDir only prefixes one level deep, which is
  // why it gets away with single-level nesting; we need real nesting here, so
  // walk the tree.
  function mkDir(name: string, children: any[]): any {
    const stamp = (child: any, parentPath: string): any => {
      const ownPath = `${parentPath}/${child.name}`;
      if (child.type === NodeKind.Directory) {
        return {
          ...child,
          path: ownPath,
          children: (child.children ?? []).map((gc: any) => stamp(gc, ownPath)),
        };
      }
      return { ...child, path: ownPath };
    };
    const prefixed = children.map((c) => stamp(c, name));
    return {
      name, type: NodeKind.Directory, path: name,
      children_count: prefixed.length,
      descendants_count: prefixed.length + prefixed.filter((c) => c.type === NodeKind.Directory).length,
      descendants_size: 1000,
      children: prefixed,
    };
  }

  it('preserves all V4 invariants on a moderately nested tree', () => {
    const tree = mkDir('root', [
      mkDir('alpha', [mkFile('aa.ts'), mkFile('ab.ts'), mkFile('ac.ts')]),
      mkFile('beta.ts'),
      mkDir('gamma', [
        mkDir('inner', [mkFile('ga.ts'), mkFile('gb.ts')]),
        mkFile('gc.ts'),
      ]),
      mkFile('delta.ts'),
    ]);
    const layout = layoutCityV4({ tree });
    expect(() => assertNoOverlap(layout)).not.toThrow();
    expect(() => assertStemOrder(layout)).not.toThrow();
    expect(() => assertTreeRespecting(layout)).not.toThrow();
    expect(() => assertTJunctionsValid(layout)).not.toThrow();
  });

  it('post-pass preserves alphabetical X-monotonicity for buildings on the same side', () => {
    // Three siblings on the same road. The post-pass may shift earlier
    // siblings forward toward later ones, but it must never reorder them.
    // a.ts < b.ts < c.ts alphabetically; after post-pass, on each side, the
    // x-coordinates must remain in the same order.
    const tree = mkDir('root', [mkFile('a.ts'), mkFile('b.ts'), mkFile('c.ts')]);
    const layout = layoutCityV4({ tree });
    const bySide: Record<number, { name: string; x: number }[]> = {};
    for (const b of layout.buildings) {
      // y-sign distinguishes side under root (X-orient).
      const side = b.y > 0 ? 1 : 0;
      bySide[side] ??= [];
      bySide[side].push({ name: (b.file as { name: string }).name, x: b.x });
    }
    for (const side of Object.keys(bySide)) {
      const xs = bySide[+side];
      const sorted = [...xs].sort((u, v) => u.name.localeCompare(v.name));
      // Alphabetical name order ↔ ascending x.
      for (let i = 0; i + 1 < sorted.length; i++) {
        expect(sorted[i].x).toBeLessThanOrEqual(sorted[i + 1].x);
      }
    }
  });
});
