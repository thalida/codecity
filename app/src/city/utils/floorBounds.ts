// city/utils/floorBounds.ts — single source of truth for the
// rendered world's spatial extent.
//
// The world is a rectangle sized to fit the city bbox plus a buffer.
// Both the world floor mesh and the tree scatter region read these
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
import { WORLD } from '@/state/stores/settings/island';

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
 * Buffer = characteristicSize × percent where characteristicSize =
 * max(width, depth, cityHeight). Pure proportional — the slider always
 * has a visible effect. Tiny cities will look tightly framed at low
 * percentages; users can crank the slider higher if they want airier
 * margins.
 */
export function getWorldBounds(
  bbox: CityBbox | null | undefined,
  cityHeight: number = 0
): WorldBounds {
  if (!bbox) {
    return {
      cx: 0,
      cz: 0,
      halfWidth: FALLBACK_HALF_DIM,
      halfDepth: FALLBACK_HALF_DIM,
    };
  }
  const bufferFrac = WORLD.value.GROUND_BUFFER_PERCENT / 100;
  const characteristicSize = Math.max(bbox.width, bbox.depth, cityHeight);
  const buffer = characteristicSize * bufferFrac;
  return {
    cx: bbox.cx,
    cz: bbox.cy, // bbox.cy is the Z-axis center in this codebase
    halfWidth: bbox.width / 2 + buffer,
    halfDepth: bbox.depth / 2 + buffer,
  };
}
