// config/sky.ts — Cyberpunk Valley sky configuration. Two nanostore
// map()s drive the procedural sky shader's uniforms via the
// hot-reloadable `applyTheme()` path. Every key is live-editable
// from the Controls panel; no rebuild is ever required.
//
//   SKY_GRADIENT — five-stop vertical color ramp + master ENABLED toggle
//                  + the solid GROUND_COLOR painted across the entire
//                  lower hemisphere (below the horizon line). The
//                  shader mirrors the gradient around the horizon for
//                  the upper hemisphere only; below dir.y=0 the shader
//                  returns GROUND_COLOR directly, producing a clean
//                  seamless horizon line with no separate floor mesh.
//                  When ENABLED is false the sphere is hidden and the
//                  existing scene.background = SCENE_COLORS.GROUND
//                  fallback paints the void.
//   SKY_STARS    — hashed point-star field above MIN_ELEVATION_DEG.
//                  DENSITY is the per-cell hash threshold (higher
//                  density ⇒ MORE stars). TWINKLE_* drives the only
//                  animation in the whole Cyberpunk Valley feature.

import { map } from 'nanostores';

export interface SkyGradientConfig {
  ENABLED: boolean;
  TOP: string;
  UPPER_MID: string;
  MID: string;
  LOWER_MID: string;
  HORIZON: string;
  GROUND_COLOR: string;
  STOP_TOP: number;
  STOP_UPPER_MID: number;
  STOP_MID: number;
  STOP_LOWER_MID: number;
  STOP_HORIZON: number;
}

export const SKY_GRADIENT = map<SkyGradientConfig>({
  ENABLED: true,
  // Cyberpunk deep-night palette: near-pure-black across most of the
  // dome, only the tiniest hint of midnight purple anywhere — so the
  // city's own neon windows stay the only bright thing in the scene.
  // The shader maps this with elev01 = 1 - abs(dir.y), so TOP renders
  // at the zenith and HORIZON at the horizon band. Below the horizon
  // (dir.y < 0), the shader returns GROUND_COLOR directly — a solid
  // fill that produces a clean horizon line and removes the need for
  // a separate floor mesh.
  TOP: '#01010a',         // near-black at zenith
  UPPER_MID: '#040315',   // deep midnight black
  MID: '#080525',         // very dark indigo
  LOWER_MID: '#100835',   // dark cyberpunk-purple
  HORIZON: '#1f1050',     // subtle horizon-line glow
  GROUND_COLOR: '#02020a', // below-horizon solid fill (seamless with TOP)
  STOP_TOP: 0.0,
  STOP_UPPER_MID: 0.35,
  STOP_MID: 0.55,
  STOP_LOWER_MID: 0.75,
  STOP_HORIZON: 0.95,
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
