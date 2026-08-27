// city/utils/floorBounds.ts — the rendered world's extent, read by both the
// floor mesh and the tree scatter so they cannot drift apart. Centred on the
// bbox rather than the gem, so a gem at one edge still gets even tree coverage.
// A missing bbox falls back to a small rectangle at the origin.
import { WORLD } from '@/state/settings/fields/island';
import type { CityBbox } from '@/city/types/scene';

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

/** buffer = max(width, depth, cityHeight) x percent. cityHeight is in the max
 *  so a small-footprint repo with tall buildings is not cramped on screen. */
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
