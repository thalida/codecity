// city/render/backdropRadius.ts — how far the backdrop orbit sits from the gem,
// counted in the gem's own framing distance. The city's extent grows with the
// project, so measuring in that put one setting on top of a small repo and
// miles off a large one.

import type { WorldBounds } from '@/city/utils/floorBounds';

export interface BackdropGeometry {
  /** The gem's own radius, from the layout. */
  gemRadius: number | null;
  /** Where the default camera rests. Off the root street's width, which is
   *  tier-bounded, so it barely moves between projects. */
  gemFitDistance: number | null;
  /** The island floor, standing in until then. */
  worldBounds: WorldBounds | null;
}

/** `t` in units of that framing distance: 1 sits where opening the project
 *  leaves you. Clamped to the camera's own limits, and never inside the gem. */
export function backdropRadius(
  t: number,
  limits: { minDistance: number; maxDistance: number },
  geometry: BackdropGeometry
): number {
  const unit =
    geometry.gemFitDistance ??
    (geometry.worldBounds
      ? Math.hypot(geometry.worldBounds.halfWidth, geometry.worldBounds.halfDepth)
      : null);
  if (unit === null) return limits.minDistance;
  const radius = Math.max(geometry.gemRadius ?? 0, unit * Math.max(t, 0));
  return Math.min(Math.max(radius, limits.minDistance), limits.maxDistance);
}
