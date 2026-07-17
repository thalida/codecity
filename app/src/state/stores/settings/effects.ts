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
    tip: 'How fast the hue cycles. Shared by the selected building outline and the gem-to-selection path line.',
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
    tip: 'Turns off the glow pass and keeps windows flat, for a before/after look.',
  },
  STRENGTH: {
    route: ChangeRoute.Refresh,
    kind: FieldKind.Slider,
    default: 0.05,
    min: 0,
    max: 1,
    step: 0.01,
    label: 'Strength',
    tip: 'Overall glow intensity. 0 disables it, 1 is full strength.',
  },
  RADIUS: {
    route: ChangeRoute.Refresh,
    kind: FieldKind.Slider,
    default: 1.0,
    min: 0,
    max: 1.0,
    step: 0.05,
    label: 'Radius',
    tip: "How far each bright pixel's glow spreads. Lower is tighter halos, higher is soft diffuse glow.",
  },
  THRESHOLD: {
    route: ChangeRoute.Refresh,
    kind: FieldKind.Slider,
    default: 0.5,
    min: 0,
    max: 2.0,
    step: 0.05,
    label: 'Threshold (cutoff)',
    tip: 'Brightness cutoff for glow: lower blooms more pixels, higher fewer. At 1.0 and above only bright windows bloom, not matte walls.',
  },
} satisfies FieldMap;

export const BLOOM = settingSignal('BLOOM', BLOOM_FIELDS);
export type BloomConfig = ConfigOf<typeof BLOOM_FIELDS>;
