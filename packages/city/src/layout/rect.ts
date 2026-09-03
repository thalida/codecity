import { Building } from '../types/building';
import { Street, StreetAxis } from '../types/street';
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

/** The four edges of a rect (center ± half-extent). Shared by the overlap test
 *  and the intersection helper so neither re-derives edges inline. */
export interface RectEdges {
  x1: number;
  x2: number;
  y1: number;
  y2: number;
}
export function rectEdges(r: Rect): RectEdges {
  return { x1: r.x - r.w / 2, x2: r.x + r.w / 2, y1: r.y - r.d / 2, y2: r.y + r.d / 2 };
}

export function _rectsOverlap(a: Rect, b: Rect): boolean {
  const A = rectEdges(a);
  const B = rectEdges(b);
  return (
    A.x1 < B.x2 - OVERLAP_EPS &&
    A.x2 > B.x1 + OVERLAP_EPS &&
    A.y1 < B.y2 - OVERLAP_EPS &&
    A.y2 > B.y1 + OVERLAP_EPS
  );
}
