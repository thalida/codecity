// city/render/showcaseRadius.ts — how far the showcase orbit sits from the gem.
// One number off the city's own geometry rather than an absolute distance, so
// the same setting means the same thing on a ten-file repo and a ten-thousand
// -file one, and no project is framed by accident.

import type { WorldBounds } from '@/city/utils/floorBounds';
import type { CityBbox } from '@/types';

export interface ShowcaseGeometry {
  /** The gem's own radius, from the layout. */
  gemRadius: number | null;
  /** The island floor, standing in before a city is built. */
  worldBounds: WorldBounds | null;
  /** The built city's extent. */
  sceneBbox: CityBbox | null;
}

/** The radius at 0 (on the gem) and at 1 (the city's own edge). */
function _ends(geometry: ShowcaseGeometry): { near: number; far: number } | null {
  const bbox = geometry.sceneBbox;
  const bounds = geometry.worldBounds;
  const far = bbox
    ? Math.max(bbox.width, bbox.depth) / 2
    : bounds
      ? Math.max(bounds.halfWidth, bounds.halfDepth)
      : null;
  return far === null ? null : { near: geometry.gemRadius ?? far, far };
}

/** `t` from 0 (on the gem) through 1 (the whole city) and past it, held inside
 *  the same limits a hand-driven camera has. */
export function showcaseRadius(
  t: number,
  limits: { minDistance: number; maxDistance: number },
  geometry: ShowcaseGeometry
): number {
  const ends = _ends(geometry);
  if (!ends) return limits.minDistance;
  const radius = ends.near + (ends.far - ends.near) * Math.max(t, 0);
  return Math.min(Math.max(radius, limits.minDistance), limits.maxDistance);
}
