// state/stores/settings/showcase.ts — the hero turntable the switcher and the
// featured city drive the world into: a ground-level orbit circling the root
// gem. All Live-routed: no rebuild reaction, the rig drives the update itself.

import { ShowcaseAnchor } from '@/types';
import {
  settingSignal,
  FieldKind,
  ChangeRoute,
  type ConfigOf,
  type FieldMap,
} from '@/state/settingsSchema';

const ANCHOR_OPTIONS = [
  { value: ShowcaseAnchor.Gem, label: 'Gem' },
  { value: ShowcaseAnchor.Island, label: 'Island edge' },
  { value: ShowcaseAnchor.City, label: 'City extent' },
];

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
  ANCHOR: {
    route: ChangeRoute.Live,
    kind: FieldKind.Select,
    default: ShowcaseAnchor.Island,
    options: ANCHOR_OPTIONS,
    label: 'Measured against',
    tip: 'What one unit of orbit radius is worth: the gem itself, the island edge, or the whole built extent.',
  },
  DISTANCE: {
    route: ChangeRoute.Live,
    kind: FieldKind.Slider,
    default: 1,
    min: 0.1,
    max: 3,
    step: 0.05,
    label: 'Orbit radius',
    tip: 'Multiples of what the radius is measured against, so every project is framed in proportion to its own size.',
  },
  ROTATE_SPEED: {
    route: ChangeRoute.Live,
    kind: FieldKind.Slider,
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
