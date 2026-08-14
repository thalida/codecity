// city/render/showcaseRadius.ts — how far the showcase orbit sits from the gem.
// A multiple of whatever it is measured around, so every project is framed in
// proportion to its own size rather than at one absolute distance that suits
// only the repo it was tuned on.

import { ShowcaseAnchor } from '@/types';
import type { WorldBounds } from '@/city/utils/floorBounds';
import type { CityBbox } from '@/types';

export interface ShowcaseAnchorGeometry {
  /** The gem's own radius, from the layout. */
  gemRadius: number | null;
  /** The island floor the city stands on. */
  worldBounds: WorldBounds | null;
  /** The built city's own extent. */
  sceneBbox: CityBbox | null;
}

/** The radius one multiple of `anchor` is worth, or null when the geometry it
 *  measures isn't built yet. */
export function anchorRadius(
  anchor: ShowcaseAnchor,
  geometry: ShowcaseAnchorGeometry
): number | null {
  if (anchor === ShowcaseAnchor.Gem) return geometry.gemRadius;
  if (anchor === ShowcaseAnchor.Island) {
    const b = geometry.worldBounds;
    // The widest circle a rectangular floor contains is its shorter half-extent.
    return b ? Math.min(b.halfWidth, b.halfDepth) : null;
  }
  const bbox = geometry.sceneBbox;
  // The circle that clears the whole city, so one multiple always contains it.
  return bbox ? Math.max(bbox.width, bbox.depth) / 2 : null;
}

/** `distance` multiples of the anchor, never closer than the controls allow.
 *  With no geometry to scale, the floor stands in, so the orbit is never zero. */
export function showcaseRadius(
  anchor: ShowcaseAnchor,
  distance: number,
  minDistance: number,
  geometry: ShowcaseAnchorGeometry
): number {
  const base = anchorRadius(anchor, geometry);
  return Math.max(base === null ? minDistance : base * distance, minDistance);
}
