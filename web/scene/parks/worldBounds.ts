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
import { PARKS_PALETTE } from '@/config/parks.js';

/** Absolute floor for the buffer in world units — protects tiny
 *  cities (small footprint, short buildings) from getting a
 *  micro-margin that the camera reads as "plane glued to the
 *  buildings." Set generously: ~800u ≈ 100 default-width buildings
 *  laid end-to-end, which always reads as visibly bare ground past
 *  the city in any framing. Degenerate (zero-extent) bboxes also
 *  fall through to this floor. */
const MIN_BUFFER = 800;

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

/**
 * Compute the world-floor rectangle from the city bbox.
 *
 * `cityHeight` (optional) is the vertical extent of the rendered
 * scene — passed in so tiny-footprint repos with TALL buildings
 * still get an airy buffer past the building bases. Without it the
 * buffer scales only with XZ extent and a small-but-tall city ends
 * up cramped on screen. Defaults to 0 (no contribution) when
 * unavailable.
 *
 * Buffer = max(MIN_BUFFER, characteristicSize × percent) where
 * characteristicSize = max(width, depth, cityHeight). The absolute
 * floor MIN_BUFFER guarantees tiny cities still feel airy.
 */
export function getWorldBounds(
  bbox: CityBbox | null | undefined,
  cityHeight: number = 0,
): WorldBounds {
  if (!bbox) {
    return {
      cx: 0,
      cz: 0,
      halfWidth: FALLBACK_HALF_DIM,
      halfDepth: FALLBACK_HALF_DIM,
    };
  }
  const bufferFrac = PARKS_PALETTE.get().GROUND_BUFFER_PERCENT / 100;
  const characteristicSize = Math.max(bbox.width, bbox.depth, cityHeight);
  const buffer = Math.max(MIN_BUFFER, characteristicSize * bufferFrac);
  return {
    cx: bbox.cx,
    cz: bbox.cy,             // bbox.cy is the Z-axis center in this codebase
    halfWidth: bbox.width / 2 + buffer,
    halfDepth: bbox.depth / 2 + buffer,
  };
}
