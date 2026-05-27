// config/world/world.ts — World sizing + background. Scene-level color
// concerns (background, atmospheric fog) live here; per-component
// visuals (island materials, sky color, etc.) live in their own
// component config.

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

// ─── Atmospheric fog ───────────────────────────────────────────────────────
// FOG_* drives the per-fragment height-fade applied by buildings'
// fragment shader (see lighting/fogChunk.ts) — a soft mist at street
// level that fades to clear at building tops.
//
// FOG_HEIGHT_FRAC — fraction of MAX_BUILDING_HEIGHT at which mist falls
//                   off. Project-relative anchor so a Linux-scale tower
//                   farm and a tiny demo project both see mist in the
//                   same relative band of the skyline. 0.25 → mist
//                   fades by mid-height of short buildings; 0.5 →
//                   halfway up the tallest.
export interface SceneColorsConfig {
  FOG_ENABLED: boolean;
  FOG_COLOR: string;
  FOG_INTENSITY: number;
  FOG_HEIGHT_FRAC: number;
}

// FOG_ENABLED off → uFogIntensity uniform is forced to 0 (the shader's
// mix() then returns the original color unchanged). Other knobs stay
// in config so flipping ENABLED back restores the haze.
export const SCENE_COLORS = map<SceneColorsConfig>({
  FOG_ENABLED: true,
  FOG_COLOR: '#0f0821',
  FOG_INTENSITY: 0.8,
  FOG_HEIGHT_FRAC: 0.5,
});
