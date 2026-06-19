// city/layout/rect.ts — the city's canonical 2D footprint rectangle, plus the
// ONE place that knows how a Street/Building maps onto it.
//
// Rect lives on the layout plane: (x, y) is the rect's CENTER and w/d are
// the FULL width/depth, matching the Building convention. The layout plane's
// y axis is the world's z axis — 3D consumers (e.g. the footprint component)
// place rects at world (x, 0, y).
//
// A Street stores its extent as length-along-axis + width-across, so turning
// one into a Rect requires the orientation swap below. Keep that swap here so
// every consumer (layout occupancy, layout invariant checks, the footprint
// slab) can never disagree.

import { StreetAxis } from '@/types';
import type { Building, Street } from '@/types';

/** Axis-aligned rectangle on the layout plane. (x, y) is the CENTER;
 *  w/d are the full width/depth (matches Building/Street conventions). */
export interface Rect {
  x: number;
  y: number;
  w: number;
  d: number;
}

/** A Building already stores center + full extents — direct mapping. */
export function rectOfBuilding(b: Building): Rect {
  return { x: b.x, y: b.y, w: b.w, d: b.d };
}

/** A Street with orientation X has its long side (length) on x and its
 *  short side (width) on y; orientation Y is the inverse. */
export function rectOfStreet(s: Street): Rect {
  if (s.orientation === StreetAxis.X) {
    return { x: s.x, y: s.y, w: s.length, d: s.width };
  }
  return { x: s.x, y: s.y, w: s.width, d: s.length };
}

// _rectsOverlap(a, b) -> boolean
//
// True iff two axis-aligned rectangles intersect by more than FP noise.
// Touching edges (zero overlap) returns false; the packer relies on this
// so that two rects abutted at exactly their sibling gap apart count as
// non-overlapping. Because layout edges are derived from CENTER ± SIZE/2
// after additive translation through non-integer offsets (e.g. a path's
// far edge `61.6 + 2 = 63.6` vs a building's near edge `66.6 - 3 =
// 63.5999…`), strict `<` comparison on FP-derived edges sporadically
// reports the touching case as a sub-femto-unit overlap.
//
// OVERLAP_EPS: tolerance for IEEE-754 noise that arises when two touching
// rects have edges computed via different additive paths (e.g. center+size/2
// vs neighbor-center-size/2 through a non-integer subAnchor). Empirically
// ~7e-15 per single translation; a few orders of magnitude higher under
// deep recursion at large coordinate scales. 1e-9 sits well above this
// noise band and far below any visible-scale geometry (smallest gap ~1
// unit), so it eliminates false-positive overlaps without masking real ones.
export const OVERLAP_EPS = 1e-9;
export function _rectsOverlap(a: Rect, b: Rect): boolean {
  const ax1 = a.x - a.w / 2,
    ax2 = a.x + a.w / 2;
  const ay1 = a.y - a.d / 2,
    ay2 = a.y + a.d / 2;
  const bx1 = b.x - b.w / 2,
    bx2 = b.x + b.w / 2;
  const by1 = b.y - b.d / 2,
    by2 = b.y + b.d / 2;
  return (
    ax1 < bx2 - OVERLAP_EPS &&
    ax2 > bx1 + OVERLAP_EPS &&
    ay1 < by2 - OVERLAP_EPS &&
    ay2 > by1 + OVERLAP_EPS
  );
}
