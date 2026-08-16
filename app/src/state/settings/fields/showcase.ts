// state/settings/fields/showcase.ts — the hero turntable the switcher and the
// featured city drive the world into: a ground-level orbit circling the root
// gem. All Live-routed: no rebuild reaction, the rig drives the update itself.

import {
  settingSignal,
  FieldKind,
  ChangeRoute,
  type ConfigOf,
  type FieldMap,
} from '@/state/settings/schema';

const SHOWCASE_FIELDS = {
  ELEVATION: {
    route: ChangeRoute.Live,
    kind: FieldKind.SliderField,
    default: 45,
    min: 0,
    max: 90,
    step: 1,
    label: 'Elevation',
    tip: 'Angle above the horizon the showcase orbits at. 0° is street level, looking straight across the city at the gem.',
  },
  AZIMUTH: {
    route: ChangeRoute.Live,
    kind: FieldKind.SliderField,
    default: 35,
    min: -180,
    max: 180,
    step: 1,
    label: 'Azimuth',
    tip: 'Where the orbit starts out, off the main street axis. Auto-rotate carries it around from there.',
  },
  DISTANCE: {
    route: ChangeRoute.Live,
    kind: FieldKind.SliderField,
    default: 0.75,
    min: 0,
    max: 2,
    step: 0.05,
    label: 'Orbit radius',
    tip: 'How far out the turntable circles the gem, in multiples of the distance the camera opens at: 1 is exactly that far, 0.5 half, 2 twice. Measured off the gem.',
  },
  ROTATE_SPEED: {
    route: ChangeRoute.Live,
    kind: FieldKind.SliderField,
    default: 0.2,
    min: 0,
    max: 3,
    step: 0.1,
    label: 'Rotation speed',
    tip: 'How fast the orbit circles. 0 holds a still frame.',
  },
} satisfies FieldMap;

export const SHOWCASE = settingSignal('SHOWCASE', SHOWCASE_FIELDS);
export type ShowcaseConfig = ConfigOf<typeof SHOWCASE_FIELDS>;
