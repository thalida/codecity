// state/stores/settings/blueprints.ts — Future files in Timeline mode: a file
// not yet created at the scrubbed commit shows as an ultra-low tinted slab where
// it will land. World-tab (draft-backed) store like ruins; ChangeRoute.Live
// (scrub reads it per frame).

import {
  settingSignal,
  FieldKind,
  ChangeRoute,
  type ConfigOf,
  type FieldMap,
} from '@/state/settingsSchema';

const BLUEPRINTS_FIELDS = {
  ENABLED: {
    route: ChangeRoute.Live,
    kind: FieldKind.Toggle,
    default: false,
    label: 'Show future files',
    tip: 'When on, a file created after the scrubbed commit shows as an ultra-low tinted slab where it will land, instead of nothing.',
  },
  BUILDING_OPACITY: {
    route: ChangeRoute.Live,
    kind: FieldKind.Slider,
    default: 0.2,
    min: 0.02,
    max: 1,
    step: 0.02,
    label: 'Building opacity',
    tip: 'How faint a future building slab is.',
  },
  BUILDING_COLOR: {
    route: ChangeRoute.Live,
    kind: FieldKind.Color,
    default: '#0d2126',
    label: 'Building color',
    tip: 'The color a future slab is tinted toward. Its own file color is pulled this way by the tint amount.',
  },
  BUILDING_TINT: {
    route: ChangeRoute.Live,
    kind: FieldKind.Slider,
    default: 0.5,
    min: 0,
    max: 1,
    step: 0.05,
    label: 'Building tint',
    tip: 'How far a future slab is pulled from its own file color toward the building color. 0 keeps the file color, 1 is fully the building color.',
  },
  ROAD_COLOR: {
    route: ChangeRoute.Live,
    kind: FieldKind.Color,
    default: '#020807',
    label: 'Road color',
    tip: 'Tint for future folder roads, so a future block reads apart from a live one.',
  },
  SIDEWALK_COLOR: {
    route: ChangeRoute.Live,
    kind: FieldKind.Color,
    default: '#071013',
    label: 'Sidewalk color',
    tip: 'Color for the sidewalk border strip of a future folder road.',
  },
} satisfies FieldMap;

export const BLUEPRINTS = settingSignal('BLUEPRINTS', BLUEPRINTS_FIELDS);
export type BlueprintsConfig = ConfigOf<typeof BLUEPRINTS_FIELDS>;
