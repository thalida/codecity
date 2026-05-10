// layoutV4.ts — Global-occupancy layout packer.
// Replaces the v3 contour-based packer. See
// docs/superpowers/specs/2026-05-10-tier-b-global-occupancy-packer-design.md

import { StreetAxis } from '@/types';
import type { Rect } from './layout';
import type { WorldOccupancy } from './worldOccupancy';

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
