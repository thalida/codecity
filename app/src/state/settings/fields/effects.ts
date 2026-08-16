// state/settings/fields/effects.ts — effects with more than one consumer
// (rainbow chase, HDR bloom), together so tuning the look does not mean chasing
// the same value through per-target stores. Both read fresh per frame.
import {
  settingSignal,
  FieldKind,
  ChangeRoute,
  type ConfigOf,
  type FieldMap,
} from '@/state/settings/schema';

// Shared by the selected building's outline and the gem-to-selection path line.
// Hue cycles at SPEED rad/ms.
const RAINBOW_FIELDS = {
  SPEED: {
    route: ChangeRoute.Live,
    kind: FieldKind.SliderField,
    default: 0.0005,
    min: 0,
    max: 0.005,
    step: 0.0001,
    label: 'Speed',
    tip: 'How fast the hue cycles. Shared by the selected building outline and the gem-to-selection path line.',
  },
  SATURATION: {
    route: ChangeRoute.Live,
    kind: FieldKind.SliderField,
    default: 1.0,
    min: 0,
    max: 1,
    step: 0.05,
    label: 'Saturation',
  },
  LIGHTNESS: {
    route: ChangeRoute.Live,
    kind: FieldKind.SliderField,
    default: 0.5,
    min: 0,
    max: 1,
    step: 0.05,
    label: 'Lightness',
  },
} satisfies FieldMap;

export const RAINBOW = settingSignal('RAINBOW', RAINBOW_FIELDS);
export type RainbowConfig = ConfigOf<typeof RAINBOW_FIELDS>;

// THRESHOLD is the luma cutoff: lit windows are written above 1.0 and cross it,
// matte walls cap at 1.0 and do not. ENABLED off also keeps everything LDR.
const BLOOM_FIELDS = {
  ENABLED: {
    route: ChangeRoute.Refresh,
    kind: FieldKind.ToggleField,
    default: true,
    label: 'Enabled',
    tip: 'Turns off the glow pass and keeps windows flat, for a before/after look.',
  },
  STRENGTH: {
    route: ChangeRoute.Refresh,
    kind: FieldKind.SliderField,
    default: 0.05,
    min: 0,
    max: 1,
    step: 0.01,
    label: 'Strength',
    tip: 'Overall glow intensity. 0 disables it, 1 is full strength.',
  },
  RADIUS: {
    route: ChangeRoute.Refresh,
    kind: FieldKind.SliderField,
    default: 1.0,
    min: 0,
    max: 1.0,
    step: 0.05,
    label: 'Radius',
    tip: "How far each bright pixel's glow spreads. Lower is tighter halos, higher is soft diffuse glow.",
  },
  THRESHOLD: {
    route: ChangeRoute.Refresh,
    kind: FieldKind.SliderField,
    default: 1.0,
    min: 0,
    max: 2.0,
    step: 0.05,
    label: 'Threshold (cutoff)',
    tip: 'Brightness cutoff for glow: lower blooms more pixels, higher fewer. At 1.0 and above only bright windows bloom, not matte walls.',
  },
} satisfies FieldMap;

export const BLOOM = settingSignal('BLOOM', BLOOM_FIELDS);
export type BloomConfig = ConfigOf<typeof BLOOM_FIELDS>;
