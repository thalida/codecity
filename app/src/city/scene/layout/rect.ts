// city/scene/layout/rect.ts — the 2D footprint rectangle, and the one place a
// Street or Building becomes one. (x, y) is the CENTRE and w/d are full
// extents, on a plane whose y is the world's z. A Street stores length-along
// and width-across, so the orientation swap lives here and nowhere else.

import { StreetAxis } from '@/city/scene/types';
import type { Building, Street } from '@/city/scene/types';

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

// Edges that should touch differ by ~7e-15 (centre ± size/2 through non-integer
// offsets), and the packer must read that as no overlap, not a sliver.
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
