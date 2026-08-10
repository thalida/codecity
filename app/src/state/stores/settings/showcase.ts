// state/stores/settings/showcase.ts — the hero turntable the switcher and the
// featured city drive the world into: a ground-level orbit circling the root
// gem. Autosave (write-through) so dragging a slider re-frames it live.
//
// ChangeRoute.Live: no rebuild/refresh reaction; the rig drives the update.

import {
  settingSignal,
  markAutosave,
  FieldKind,
  ChangeRoute,
  type ConfigOf,
  type FieldMap,
} from '@/state/settingsSchema';

const SHOWCASE_FIELDS = {
  ELEVATION: {
    route: ChangeRoute.Live,
    kind: FieldKind.Slider,
    default: 3,
    min: 0,
    max: 90,
    step: 1,
    label: 'Elevation',
    tip: 'Angle above the horizon the showcase orbits at. 0° is street level, looking straight across the city at the gem.',
  },
  AZIMUTH: {
    route: ChangeRoute.Live,
    kind: FieldKind.Slider,
    default: 35,
    min: -180,
    max: 180,
    step: 1,
    label: 'Azimuth',
    tip: 'Where the orbit starts out, off the main street axis. Auto-rotate carries it around from there.',
  },
  DISTANCE: {
    route: ChangeRoute.Live,
    kind: FieldKind.Slider,
    default: 800,
    min: 50,
    max: 5000,
    step: 50,
    label: 'Orbit radius',
    tip: 'How far out the orbit circles the gem, in world units. Held the same for every project, so a big repo just means more city between you and the gem. Pulled in when it would carry the camera past the island edge.',
  },
  ROTATE_SPEED: {
    route: ChangeRoute.Live,
    kind: FieldKind.Slider,
    default: 0.3,
    min: 0,
    max: 3,
    step: 0.1,
    label: 'Rotation speed',
    tip: 'How fast the orbit circles. 0 holds a still frame.',
  },
} satisfies FieldMap;

export const SHOWCASE = settingSignal('SHOWCASE', SHOWCASE_FIELDS);
markAutosave(SHOWCASE);
export type ShowcaseConfig = ConfigOf<typeof SHOWCASE_FIELDS>;
