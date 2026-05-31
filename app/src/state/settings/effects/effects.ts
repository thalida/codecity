// state/settings/effects.js — Cross-cutting visual effects shared between multiple
// consumers. Keeping these in one place means tweaking the look (e.g. "make
// all rainbows slower") doesn't require chasing the same values through
// multiple per-target stores.

import { persistedSignal } from '@/state/persist';

// Chasing-rainbow effect used by BOTH the selected building's neon
// outline and the gem→selection neon path line. Both consumers cycle hue
// at SPEED rad/ms; SATURATION + LIGHTNESS set the palette intensity.
// Hot-reloadable; both consumers read fresh per frame.
export interface RainbowConfig {
  SPEED: number;
  SATURATION: number;
  LIGHTNESS: number;
}

export const RAINBOW = persistedSignal<RainbowConfig>('RAINBOW', {
  SPEED: 0.0005, // hue cycles per millisecond
  SATURATION: 1.0,
  LIGHTNESS: 0.5,
});

// Bloom (UnrealBloomPass) — screen-space neon glow for HDR pixels.
// THRESHOLD is the luma cutoff above which a pixel contributes to bloom;
// our HDR pipeline writes lit windows above 1.0 so they cross this
// threshold while matte walls (capped at 1.0) don't.
//
//   STRENGTH        — overall bloom intensity multiplier. 0 = off.
//   RADIUS          — how far each bright pixel's glow spreads.
//   THRESHOLD       — luma cutoff (in HDR linear space). >=1.0 means
//                     "only HDR-pushed pixels bloom."
//   WINDOW_EMISSION — extra HDR emission for the freshest building's
//                     lit windows, on top of the baseline 1.0. 0 = no
//                     bloom contribution from windows.
//   GEM_EMISSION    — HDR multiplier applied to the root-gem's halo
//                     sprites every frame, scaling the bloom they
//                     contribute INDEPENDENTLY of WINDOW_EMISSION. 1 =
//                     LDR (no bloom from gem); higher = stronger neon
//                     halo around the gem regardless of window bloom.
//
// Hot-reloadable: refreshPostFx() pushes STRENGTH/RADIUS/THRESHOLD
// into the bloom pass, refreshBuildingMaterial() pushes WINDOW_EMISSION
// into the shader, and the animate() loop reads GEM_EMISSION every
// frame when re-tinting the halo sprites.
export interface BloomConfig {
  ENABLED: boolean;
  STRENGTH: number;
  RADIUS: number;
  THRESHOLD: number;
  WINDOW_EMISSION: number;
  GEM_EMISSION: number;
  AD_EMISSION: number;
}

// ENABLED off → bloom pass bypassed AND shader pushes lit windows /
// gem halos / billboard panels at LDR only (no HDR boost), so the
// result approximates the pre-HDR "flat" look for side-by-side
// comparison. The other knobs stay in config so flipping ENABLED back
// picks up where you left off.
//
// AD_EMISSION multiplies the ad-panel MeshBasicMaterial's
// color tint so bright pixels in the texture push past 1.0 in linear
// space → bloom picks them up. 1.0 = LDR (no bloom); 2.5 = neon
// storefront. Dark image pixels stay below threshold.
export const BLOOM = persistedSignal<BloomConfig>('BLOOM', {
  ENABLED: true,
  STRENGTH: 0.1,
  RADIUS: 1.0,
  THRESHOLD: 0.5,
  WINDOW_EMISSION: 1.0,
  GEM_EMISSION: 0.5,
  AD_EMISSION: 0.6,
});
