// config/sky.ts — Cyberpunk Valley sky configuration. Two nanostore
// map()s drive the procedural sky shader's uniforms via the
// hot-reloadable `applyTheme()` path.
//
//   SKY       — flat two-color backdrop. COLOR fills the entire upper
//                hemisphere (dir.y >= 0); GROUND_COLOR fills the lower
//                hemisphere. The seam at dir.y=0 is a clean horizon line.
//                When ENABLED is false the icosphere is hidden entirely
//                and the existing scene.background = SCENE_COLORS.GROUND
//                fallback paints the void.
//   SKY_STARS — hashed point-star field above MIN_ELEVATION_DEG, only
//                drawn against the upper-hemisphere SKY.COLOR. The
//                shader gates stars by dir.y > uStarMinElevation, so
//                they never appear in the ground hemisphere.

import { map } from 'nanostores';

export interface SkyConfig {
  ENABLED: boolean;
  COLOR: string;
  GROUND_COLOR: string;
}

export const SKY = map<SkyConfig>({
  ENABLED: true,
  COLOR: '#000000',         // upper hemisphere (above dir.y=0)
  GROUND_COLOR: '#000000',  // lower hemisphere (below dir.y=0)
});

export interface SkyStarsConfig {
  ENABLED: boolean;
  DENSITY: number;
  SIZE: number;
  BRIGHTNESS: number;
  TWINKLE_ENABLED: boolean;
  TWINKLE_SPEED: number;
  TWINKLE_AMPLITUDE: number;
  MIN_ELEVATION_DEG: number;
}

export const SKY_STARS = map<SkyStarsConfig>({
  ENABLED: true,
  // 0.0075 — user-tuned default that lands ~680 stars across the
  // upper hemisphere. Dense enough to read as a starry night, sparse
  // enough to keep individual stars distinct. Stars are rendered as
  // small circular sub-cell dots (see SIZE) so the per-cell scale
  // can stay coarse without making each star huge.
  DENSITY: 0.0075,
  // Star spot radius as a fraction of the cell. 0.15 = each star
  // occupies a circle ~15% of the cell's width, with a smoothstep
  // antialiased edge. Larger values = chunkier stars.
  SIZE: 0.15,
  BRIGHTNESS: 1.2,
  TWINKLE_ENABLED: true,
  TWINKLE_SPEED: 0.5,
  TWINKLE_AMPLITUDE: 1.0,
  MIN_ELEVATION_DEG: 8,
});
