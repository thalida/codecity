// config/world.ts — World-level geometry configuration.
//
// Controls the world floor plane and the buffer around the city.
// These are properties of "the world", not of any foliage layer.

import { map } from 'nanostores';

export interface WorldConfig {
  /** Master toggle — when false the valley-floor plane is hidden. */
  ENABLED: boolean;

  /** Color of the world floor mesh — the actual ground the camera sees
   *  within the world bounds. A large flat plane world-anchored at y=0
   *  beneath the gem, tinted to give the ground a dark forest color. */
  GROUND_COLOR: string;

  /** Whether the floor mesh is visible. Disable to see the sky behind
   *  everything (useful for debugging world bounds). */
  GROUND_ENABLED: boolean;

  /** Padding past the city's bounding box as a percentage of the city's
   *  longest dimension. 0 = plane exactly fits the city; 30 = default
   *  generous halo of bare ground; 50 = very wide margin. */
  GROUND_BUFFER_PERCENT: number;
}

export const WORLD = map<WorldConfig>({
  ENABLED: true,

  // Dark forest tone — what the camera sees as "the floor of the
  // world" anywhere there isn't city geometry or a discrete tree.
  GROUND_COLOR: '#030706',

  GROUND_ENABLED: true,

  // 30% of the city's longest dimension (including vertical extent for
  // small-but-tall cities) — a generous halo of bare ground past the
  // city, capped at an absolute floor in worldBounds so tiny cities
  // still feel airy.
  GROUND_BUFFER_PERCENT: 30,
});
