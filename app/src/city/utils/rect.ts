// city/utils/rect.ts — the city's canonical 2D footprint rectangle, plus the
// ONE place that knows how a Street/Building maps onto it.
//
// Rect lives on the layout plane: (x, y) is the rect's CENTER and w/d are
// the FULL width/depth, matching the Building convention. The layout plane's
// y axis is the world's z axis — 3D consumers (e.g. the footprint component)
// place rects at world (x, 0, y).
//
// A Street stores its extent as length-along-axis + width-across, so turning
// one into a Rect requires the orientation swap below. That swap used to be
// re-derived inline by every consumer (layout occupancy, layout invariant
// checks, the footprint slab) — keep it here so they can never disagree.

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
