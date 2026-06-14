// state/stores/settings/effects.ts — Cross-cutting visual effects shared
// between multiple consumers (rainbow chase + HDR bloom). Keeping them in one
// place means tweaking the look (e.g. "slower rainbows") doesn't require
// chasing the same values through per-target stores.
//
// Schema-driven (see state/schema). Both consumers read fresh per
// frame, so changes are hot.

import {
  settingSignal,
  FieldKind,
  ChangeRoute,
  type ConfigOf,
  type FieldMap,
} from '@/state/settingsSchema';

// Chasing-rainbow used by BOTH the selected building's neon outline and the
// gem→selection neon path line. Hue cycles at SPEED rad/ms; SATURATION +
// LIGHTNESS set palette intensity.
const RAINBOW_FIELDS = {
  SPEED: {
    route: ChangeRoute.Live,
    kind: FieldKind.Slider,
    default: 0.0005,
    min: 0,
    max: 0.005,
    step: 0.0001,
    label: 'Speed',
    tip: 'Hue cycles per millisecond. The shared rainbow chases around the selected building outline AND the gem→selection path line.',
  },
  SATURATION: {
    route: ChangeRoute.Live,
    kind: FieldKind.Slider,
    default: 1.0,
    min: 0,
    max: 1,
    step: 0.05,
    label: 'Saturation',
  },
  LIGHTNESS: {
    route: ChangeRoute.Live,
    kind: FieldKind.Slider,
    default: 0.5,
    min: 0,
    max: 1,
    step: 0.05,
    label: 'Lightness',
  },
} satisfies FieldMap;

export const RAINBOW = settingSignal('RAINBOW', RAINBOW_FIELDS);
export type RainbowConfig = ConfigOf<typeof RAINBOW_FIELDS>;

// Bloom (UnrealBloomPass) — screen-space neon glow for HDR pixels. THRESHOLD is
// the luma cutoff above which a pixel blooms; the HDR pipeline writes lit
// windows above 1.0 so they cross it while matte walls (capped at 1.0) don't.
// ENABLED off bypasses the pass AND keeps windows/gem/ads LDR (pre-HDR "flat"
// look) for side-by-side comparison; other knobs persist.
const BLOOM_FIELDS = {
  ENABLED: {
    route: ChangeRoute.Refresh,
    kind: FieldKind.Toggle,
    default: true,
    label: 'Enabled',
    tip: 'Off → bloom pass bypassed AND windows/gem stay LDR — approximates the pre-HDR "flat" look for side-by-side comparison. Other knobs stay in config.',
  },
  STRENGTH: {
    route: ChangeRoute.Refresh,
    kind: FieldKind.Slider,
    default: 0.1,
    min: 0,
    max: 1,
    step: 0.01,
    label: 'Strength',
    tip: 'Overall bloom intensity multiplier. 0 = bloom pass produces nothing; 1 = full strength.',
  },
  RADIUS: {
    route: ChangeRoute.Refresh,
    kind: FieldKind.Slider,
    default: 1.0,
    min: 0,
    max: 1.0,
    step: 0.05,
    label: 'Radius',
    tip: "How far each bright pixel's glow spreads. Lower = tighter halos; higher = soft diffuse glow.",
  },
  THRESHOLD: {
    route: ChangeRoute.Refresh,
    kind: FieldKind.Slider,
    default: 0.5,
    min: 0,
    max: 2.0,
    step: 0.05,
    label: 'Threshold (cutoff)',
    tip: 'Luma CUTOFF — pixels below this value contribute nothing to bloom. NOT an intensity dial: lower threshold = more pixels qualify = more total bloom; higher = fewer pixels glow. ≥1.0 keeps matte walls (capped at 1.0) clean and only blooms the HDR-pushed window pixels.',
  },
} satisfies FieldMap;

export const BLOOM = settingSignal('BLOOM', BLOOM_FIELDS);
export type BloomConfig = ConfigOf<typeof BLOOM_FIELDS>;
