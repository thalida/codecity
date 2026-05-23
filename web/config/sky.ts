// config/sky.ts — Cyberpunk Valley sky configuration. Two nanostore
// map()s drive the procedural sky shader's uniforms via the
// hot-reloadable `applyTheme()` path.
//
//   SKY       — two-color backdrop. COLOR fills the full sphere
//                (above and below the horizon); HORIZON_COLOR creates
//                a soft glow band that fades from the horizon line up
//                through HORIZON_HEIGHT. Below the horizon, the world
//                floor mesh paints real ground — the sky just shows
//                solid COLOR there. When ENABLED is false the
//                icosphere is hidden entirely and the existing
//                scene.background = SCENE_COLORS.GROUND fallback
//                paints the void.
//   SKY_STARS — hashed point-star field above MIN_ELEVATION_DEG, only
//                drawn against the upper-hemisphere SKY.COLOR. The
//                shader gates stars by dir.y > uStarMinElevation, so
//                they never appear near or below the horizon.

import { map } from 'nanostores';

export interface SkyConfig {
  ENABLED: boolean;
  COLOR: string;
  HORIZON_COLOR: string;
  HORIZON_HEIGHT: number;
}

export const SKY = map<SkyConfig>({
  ENABLED: true,
  COLOR: '#000000',         // full-sphere flat fill (above + below horizon)
  // Subtle dark-indigo atmosphere glow that fades from the horizon line
  // (dir.y → 0+) up to dir.y = HORIZON_HEIGHT, where it blends fully
  // into COLOR. The shader uses smoothstep, so the falloff is smooth.
  HORIZON_COLOR: '#04030c',
  // Fraction of the upper hemisphere occupied by the horizon glow. 0.15
  // = bottom ~8.6° has the glow; the upper ~85% of the dome is flat
  // COLOR. 0 disables the band entirely.
  HORIZON_HEIGHT: 0.15,
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
