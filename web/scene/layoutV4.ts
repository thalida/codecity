// layoutV4.ts — Global-occupancy layout packer.
// Replaces the v3 contour-based packer. See
// docs/superpowers/specs/2026-05-10-tier-b-global-occupancy-packer-design.md

import { StreetAxis } from '@/types';
import type { Rect } from './layout';
import type { WorldOccupancy, WorldRect, WorldRectKind } from './worldOccupancy';

// computeFlips(parentOrient, side, mirror) → {flipX, flipY}
//
// For X-orient parent: side flips perp (Y), mirror flips along (X) of the child.
// For Y-orient parent: side flips perp (X), mirror flips along (Y) of the child.
//
// Matches the existing v3 packer's flip rules so renderer-side expectations
// (T-junction geometry, door direction) are preserved.
export function computeFlips(
  parentOrient: StreetAxis,
  side: 0 | 1,
  mirror: boolean
): { flipX: boolean; flipY: boolean } {
  if (parentOrient === StreetAxis.X) {
    return { flipX: mirror, flipY: side === 0 };
  }
  return { flipX: side === 0, flipY: mirror };
}

// applyFlips(rect, flipX, flipY) → flipped Rect
//
// Negates the rect's center coordinates per the flip flags. Width and depth
// are unchanged (rects are AABBs, not oriented).
export function applyFlips(rect: Rect, flipX: boolean, flipY: boolean): Rect {
  return {
    x: flipX ? -rect.x : rect.x,
    y: flipY ? -rect.y : rect.y,
    w: rect.w,
    d: rect.d,
  };
}

// isMirrorInvariant(rects, parentOrient) → boolean
//
// True iff mirroring across the perp axis (the axis flipped by `mirror=true`)
// produces the same rect list (within OVERLAP_EPS). Used to skip mirror=true
// variants when they'd be no-ops.
//
// For X-orient parent: mirror flips X. Invariant iff for every rect there's a
// matching rect with -x and same y, w, d.
// For Y-orient parent: mirror flips Y. Symmetric.
const OVERLAP_EPS = 1e-9;
export function isMirrorInvariant(rects: Rect[], parentOrient: StreetAxis): boolean {
  // Empty list is trivially invariant.
  if (rects.length === 0) return true;
  // For each rect r in rects, the mirrored r must also exist in rects.
  // O(n²) but n is small per subtree; acceptable.
  for (const r of rects) {
    let found = false;
    for (const s of rects) {
      const mirrorX = parentOrient === StreetAxis.X ? -r.x : r.x;
      const mirrorY = parentOrient === StreetAxis.Y ? -r.y : r.y;
      if (
        Math.abs(s.x - mirrorX) <= OVERLAP_EPS &&
        Math.abs(s.y - mirrorY) <= OVERLAP_EPS &&
        Math.abs(s.w - r.w) <= OVERLAP_EPS &&
        Math.abs(s.d - r.d) <= OVERLAP_EPS
      ) {
        found = true;
        break;
      }
    }
    if (!found) return false;
  }
  return true;
}

interface FindSmallestValidStemParams {
  childRects: Rect[];           // rects in CHILD-LOCAL frame
  parentOrient: StreetAxis;
  side: 0 | 1;
  mirror: boolean;
  parentOriginX: number;        // parent's main-street origin in world
  parentOriginY: number;
  priorStem: number;            // alphabetical-monotonic: stem ≥ priorStem
  originPad: number;            // stem ≥ originPad (parent's join clearance)
  childGap: number;             // minimum gap between this child and others
  occupancy: WorldOccupancy;    // global occupancy structure
}

// findSmallestValidStem — Section 3 of the spec.
//
// For one (side, mirror) variant, compute the smallest stem ≥ max(priorStem,
// originPad) such that translating every child rect by (side, mirror, stem,
// parentOrigin) doesn't overlap any rect in occupancy. Uses the forbidden-
// interval union algorithm for gap-fit packing.
export function findSmallestValidStem(p: FindSmallestValidStemParams): number {
  const { flipX, flipY } = computeFlips(p.parentOrient, p.side, p.mirror);

  // Collect forbidden stem intervals from all (childRect, candidate) pairs.
  const forbidden: { lower: number; upper: number }[] = [];

  for (const r of p.childRects) {
    const flipped = applyFlips(r, flipX, flipY);

    // For X-orient parent: parent's along axis = X, perp axis = Y.
    //   alongMin_at_stem_0 = flipped.x - flipped.w/2 + parentOriginX
    //   alongMax_at_stem_0 = flipped.x + flipped.w/2 + parentOriginX
    //   perpMin = flipped.y - flipped.d/2 + parentOriginY
    //   perpMax = flipped.y + flipped.d/2 + parentOriginY
    // For Y-orient parent: swap roles of X and Y.
    let alongMin0: number, alongMax0: number, perpMin: number, perpMax: number;
    if (p.parentOrient === StreetAxis.X) {
      alongMin0 = flipped.x - flipped.w / 2 + p.parentOriginX;
      alongMax0 = flipped.x + flipped.w / 2 + p.parentOriginX;
      perpMin = flipped.y - flipped.d / 2 + p.parentOriginY;
      perpMax = flipped.y + flipped.d / 2 + p.parentOriginY;
    } else {
      perpMin = flipped.x - flipped.w / 2 + p.parentOriginX;
      perpMax = flipped.x + flipped.w / 2 + p.parentOriginX;
      alongMin0 = flipped.y - flipped.d / 2 + p.parentOriginY;
      alongMax0 = flipped.y + flipped.d / 2 + p.parentOriginY;
    }

    // Query occupancy in r's fixed perp band (full along range).
    const candidates =
      p.parentOrient === StreetAxis.X
        ? p.occupancy.query(-Infinity, perpMin, Infinity, perpMax)
        : p.occupancy.query(perpMin, -Infinity, perpMax, Infinity);

    for (const g of candidates) {
      const gMinAlong = p.parentOrient === StreetAxis.X ? g.minX : g.minY;
      const gMaxAlong = p.parentOrient === StreetAxis.X ? g.maxX : g.maxY;

      // r at stem s overlaps g (with gap) iff s ∈ (lower, upper).
      const lower = gMinAlong - alongMax0 - p.childGap;
      const upper = gMaxAlong - alongMin0 + p.childGap;
      if (upper > lower) forbidden.push({ lower, upper });
    }
  }

  // Sort forbidden intervals by lower, then walk to find first gap ≥
  // max(priorStem, originPad).
  forbidden.sort((a, b) => a.lower - b.lower);
  let s = Math.max(p.priorStem, p.originPad);
  for (const interval of forbidden) {
    if (s < interval.lower) return s; // s is already in a gap before this interval
    if (s < interval.upper) s = interval.upper; // s was inside; skip past
  }
  return s;
}

interface PlaceChildParams {
  childRects: Rect[];
  parentOrient: StreetAxis;
  parentOriginX: number;
  parentOriginY: number;
  priorStem: number;
  originPad: number;
  childGap: number;
  occupancy: WorldOccupancy;
}

export interface PlaceChildResult {
  stem: number;
  side: 0 | 1;
  mirror: boolean;
}

// placeChild — Section 4 of the spec.
//
// Evaluates 4 (side × mirror) variants and picks the one with smallest stem.
// If mirror is invariant (the rect list is unchanged by perp-axis flip), only
// 2 variants (mirror=false) are evaluated.
//
// Tiebreak chain (when stems tie within OVERLAP_EPS):
//   1. Smaller stem wins (strict).
//   2. If stems tie: side 0 over side 1.
//   3. If sides tie: natural over mirrored.
//   4. If both tie: smaller stem within eps (mostly redundant).
export function placeChild(p: PlaceChildParams): PlaceChildResult {
  const mirrorInvariant = isMirrorInvariant(p.childRects, p.parentOrient);

  let bestStem = +Infinity;
  let bestSide: 0 | 1 = 0;
  let bestMirror = false;

  const tryVariant = (side: 0 | 1, mirror: boolean): void => {
    const stem = findSmallestValidStem({
      childRects: p.childRects,
      parentOrient: p.parentOrient,
      side,
      mirror,
      parentOriginX: p.parentOriginX,
      parentOriginY: p.parentOriginY,
      priorStem: p.priorStem,
      originPad: p.originPad,
      childGap: p.childGap,
      occupancy: p.occupancy,
    });

    // Tiebreak chain.
    let better = false;
    if (stem < bestStem - OVERLAP_EPS) {
      better = true;
    } else if (Math.abs(stem - bestStem) <= OVERLAP_EPS) {
      if (side < bestSide) better = true;
      else if (side === bestSide) {
        if (!mirror && bestMirror) better = true;
      }
    }
    if (better) {
      bestStem = stem;
      bestSide = side;
      bestMirror = mirror;
    }
  };

  tryVariant(0, false);
  tryVariant(1, false);
  if (!mirrorInvariant) {
    tryVariant(0, true);
    tryVariant(1, true);
  }

  return { stem: bestStem, side: bestSide, mirror: bestMirror };
}

// Typed rect with kind+ref preserved through translation. The child's
// pre-compute returns rects in this shape so we can translate them to
// WorldRect for occupancy insert.
export interface TypedRect extends Rect {
  kind: WorldRectKind;
  ref: WorldRect['ref'];
}

// translateRectsToWorld — applies (side, mirror) flips + parent origin +
// stem offset to convert child-local rects to world-frame WorldRects.
//
// For an X-orient parent: stem shifts along X.
// For a Y-orient parent: stem shifts along Y.
export function translateRectsToWorld(
  childRects: Array<Rect | TypedRect>,
  parentOrient: StreetAxis,
  parentOriginX: number,
  parentOriginY: number,
  stem: number,
  side: 0 | 1,
  mirror: boolean
): WorldRect[] {
  const { flipX, flipY } = computeFlips(parentOrient, side, mirror);
  const out: WorldRect[] = [];
  for (const r of childRects) {
    const flipped = applyFlips(r, flipX, flipY);
    // Add parent origin and stem along the parent's along axis.
    const worldX =
      flipped.x +
      parentOriginX +
      (parentOrient === StreetAxis.X ? stem : 0);
    const worldY =
      flipped.y +
      parentOriginY +
      (parentOrient === StreetAxis.Y ? stem : 0);
    const typed = r as TypedRect;
    out.push({
      minX: worldX - flipped.w / 2,
      minY: worldY - flipped.d / 2,
      maxX: worldX + flipped.w / 2,
      maxY: worldY + flipped.d / 2,
      kind: typed.kind ?? 'building',
      ref: typed.ref ?? ({} as never),
    });
  }
  return out;
}
