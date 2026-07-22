// state/stores/settings/blueprints.ts — Blueprints in Timeline mode: a file not
// yet created at the scrubbed commit shows as a faint ghost of the building it
// will become, fading out the further ahead its creation is. World-tab
// (draft-backed) store like ruins; ChangeRoute.Live (scrub reads it per frame).

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
    label: 'Show blueprints',
    tip: 'When on, a file created after the scrubbed commit shows as a faint ghost of what it will become, instead of nothing.',
  },
  OPACITY: {
    route: ChangeRoute.Live,
    kind: FieldKind.Slider,
    default: 0.3,
    min: 0.02,
    max: 1,
    step: 0.02,
    label: 'Opacity',
    tip: 'How faint a blueprint is at its brightest (right before it is created).',
  },
  LOOK_AHEAD: {
    route: ChangeRoute.Live,
    kind: FieldKind.Slider,
    default: 400,
    min: 10,
    max: 5000,
    step: 10,
    label: 'Look ahead (commits)',
    tip: 'How far into the future to reveal blueprints. A building fades from full at its creation back to nothing this many commits earlier.',
  },
  COLOR: {
    route: ChangeRoute.Live,
    kind: FieldKind.Color,
    default: '#4fd6e8',
    label: 'Blueprint color',
    tip: 'Tint for not-yet-built buildings and their roads, so the future reads apart from the live city.',
  },
} satisfies FieldMap;

export const BLUEPRINTS = settingSignal('BLUEPRINTS', BLUEPRINTS_FIELDS);
export type BlueprintsConfig = ConfigOf<typeof BLUEPRINTS_FIELDS>;
