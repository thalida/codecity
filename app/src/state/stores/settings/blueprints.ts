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
    default: true,
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
  ROAD_OPACITY: {
    route: ChangeRoute.Live,
    kind: FieldKind.Slider,
    default: 0.15,
    min: 0.02,
    max: 1,
    step: 0.02,
    label: 'Road opacity',
    tip: 'How faint a future folder road is.',
  },
  BUILDING_COLOR: {
    route: ChangeRoute.Live,
    kind: FieldKind.Color,
    default: '#2c7d68',
    label: 'Building color',
    tip: 'Tint for future building slabs, so they read apart from the live city.',
  },
  ROAD_COLOR: {
    route: ChangeRoute.Live,
    kind: FieldKind.Color,
    default: '#020807',
    label: 'Road color',
    tip: 'Tint for future folder roads, so a future block reads apart from a live one.',
  },
} satisfies FieldMap;

export const BLUEPRINTS = settingSignal('BLUEPRINTS', BLUEPRINTS_FIELDS);
export type BlueprintsConfig = ConfigOf<typeof BLUEPRINTS_FIELDS>;
