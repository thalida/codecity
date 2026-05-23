// scene/parks/worldBounds.ts — single source of truth for the
// rendered world's spatial extent.
//
// The world is a rectangle sized to fit the city bbox plus a buffer.
// Both the valley floor mesh and the tree scatter region read these
// helpers so they stay in lockstep — if you change the buffer logic,
// both update.
//
// The plane is centered on the bbox center (not the gem) so it
// covers the city symmetrically. Trees still sort by distance to the
// gem (the chronological-outward semantic), but they're sampled
// within these bounds — so even a city with the gem at one edge of
// the bbox has uniform tree coverage across the whole floor.
//
// For null/missing bbox (pre-layout / non-git smoke tests) we fall
// back to a small default rectangle at the origin so the floor still
// renders.

import type { CityBbox } from '@/types';

/** Fraction of the larger bbox dimension to add as buffer on each
 *  side. 0.15 = 15% past the city edge in both X and Z. The same
 *  absolute buffer is applied to both axes for visual consistency. */
const BUFFER_FRAC_OF_MAX_DIM = 0.15;

/** Minimum buffer in world units — so tiny cities still get a
 *  visible margin past the buildings, and degenerate (zero-extent)
 *  bboxes still produce a visible plane. */
const MIN_BUFFER = 200;

/** Fallback half-extent when no bbox is available (pre-layout,
 *  non-git smoke tests). Keeps the floor visible at the origin. */
const FALLBACK_HALF_DIM = 500;

export interface WorldBounds {
  /** World X coordinate of the plane's center. */
  cx: number;
  /** World Z coordinate of the plane's center. */
  cz: number;
  /** Half the plane's width (extent along world X). */
  halfWidth: number;
  /** Half the plane's depth (extent along world Z). */
  halfDepth: number;
}

export function getWorldBounds(bbox: CityBbox | null | undefined): WorldBounds {
  if (!bbox) {
    return {
      cx: 0,
      cz: 0,
      halfWidth: FALLBACK_HALF_DIM,
      halfDepth: FALLBACK_HALF_DIM,
    };
  }
  const maxDim = Math.max(bbox.width, bbox.depth);
  const buffer = Math.max(MIN_BUFFER, maxDim * BUFFER_FRAC_OF_MAX_DIM);
  return {
    cx: bbox.cx,
    cz: bbox.cy,             // bbox.cy is the Z-axis center in this codebase
    halfWidth: bbox.width / 2 + buffer,
    halfDepth: bbox.depth / 2 + buffer,
  };
}
