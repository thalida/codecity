// config/sky.ts — Cyberpunk Valley sky configuration. Three nanostore
// map()s drive the procedural sky shader's uniforms via the
// hot-reloadable `applyTheme()` path. Every key is live-editable
// from the Controls panel; no rebuild is ever required for sky tweaks.
//
//   SKY_GRADIENT — five-stop vertical color ramp + master ENABLED toggle.
//                  When ENABLED is false the sphere is hidden and the
//                  existing scene.background = SCENE_COLORS.GROUND
//                  fallback paints the void.
//   SKY_STARS    — hashed point-star field above MIN_ELEVATION_DEG.
//                  DENSITY is the per-cell hash threshold (higher density
//                  ⇒ MORE stars). TWINKLE_* drives the only animation
//                  in the whole Cyberpunk Valley feature.
//   SKY_MOON     — single warm moon disk + glow halo at a fixed world
//                  direction. EMISSION_BOOST > 1 makes the disk center
//                  push past 1.0 in the HDR target so it blooms via
//                  postFx.ts.

import { map } from 'nanostores';

export interface SkyGradientConfig {
  ENABLED: boolean;
  TOP: string;
  UPPER_MID: string;
  MID: string;
  LOWER_MID: string;
  HORIZON: string;
  STOP_TOP: number;
  STOP_UPPER_MID: number;
  STOP_MID: number;
  STOP_LOWER_MID: number;
  STOP_HORIZON: number;
}

export const SKY_GRADIENT = map<SkyGradientConfig>({
  ENABLED: true,
  // Cyberpunk night palette: near-black at the zenith, deepening
  // through midnight purples to a subtle magenta city-glow at the
  // horizon line. The shader mirrors this gradient around the
  // horizon (elev01 = 1 - abs(dir.y)), so TOP renders at the zenith
  // AND below the horizon (where the floor plane covers it), and
  // HORIZON renders in the bright atmosphere-glow band right at the
  // horizon line.
  TOP: '#020208',        // near-black zenith
  UPPER_MID: '#0a0518',  // deep purple-black
  MID: '#150830',        // dark midnight purple
  LOWER_MID: '#26104a',  // medium midnight purple
  HORIZON: '#3a1860',    // subtle cyberpunk magenta glow at the horizon
  STOP_TOP: 0.0,
  STOP_UPPER_MID: 0.35,
  STOP_MID: 0.55,
  STOP_LOWER_MID: 0.75,
  STOP_HORIZON: 0.95,
});

export interface SkyStarsConfig {
  ENABLED: boolean;
  DENSITY: number;
  BRIGHTNESS: number;
  TWINKLE_ENABLED: boolean;
  TWINKLE_SPEED: number;
  TWINKLE_AMPLITUDE: number;
  MIN_ELEVATION_DEG: number;
}

export const SKY_STARS = map<SkyStarsConfig>({
  ENABLED: true,
  DENSITY: 0.0008,
  BRIGHTNESS: 1.2,
  TWINKLE_ENABLED: true,
  TWINKLE_SPEED: 0.4,
  TWINKLE_AMPLITUDE: 0.5,
  MIN_ELEVATION_DEG: 8,
});

export interface SkyMoonConfig {
  ENABLED: boolean;
  AZIMUTH_DEG: number;
  ELEVATION_DEG: number;
  SIZE_DEG: number;
  COLOR: string;
  HALO_COLOR: string;
  HALO_SIZE_MULT: number;
  EMISSION_BOOST: number;
}

export const SKY_MOON = map<SkyMoonConfig>({
  ENABLED: false, // off by default — user can toggle on from Controls panel
  AZIMUTH_DEG: 260,
  ELEVATION_DEG: 22,
  SIZE_DEG: 4.5,
  COLOR: '#ffe6c4',
  HALO_COLOR: '#ffb86b',
  HALO_SIZE_MULT: 4.0,
  EMISSION_BOOST: 1.8,
});
