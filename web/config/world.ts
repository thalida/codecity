// config/world.ts — World sizing config. Visual ground concerns moved
// to ISLAND.* in config/island.ts.

import { map } from 'nanostores';

export interface WorldConfig {
  /** Padding past the city's bounding box as a percentage of the city's
   *  longest dimension. 0 = plane exactly fits the city; 30 = default
   *  generous halo of bare ground; 50 = very wide margin. */
  GROUND_BUFFER_PERCENT: number;
}

export const WORLD = map<WorldConfig>({
  // 0% by default — the island polygon already has a built-in sqrt(2) ×
  // 1/cos(π/N) expansion past the city bbox so the city is comfortably
  // contained without extra padding. Users dial this up if they want
  // more visible "bare ground" past the city silhouette.
  GROUND_BUFFER_PERCENT: 0,
});
