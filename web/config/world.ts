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
  // 30% of the city's longest dimension (including vertical extent for
  // small-but-tall cities) — a generous halo of bare ground past the
  // city, capped at an absolute floor in worldBounds so tiny cities
  // still feel airy.
  GROUND_BUFFER_PERCENT: 30,
});
