// settings/fields/camera.ts — where a city's camera sits and what it does
// there. One vocabulary for every camera, because there is only ever one camera
// per city: what used to be two stores was two cities sharing a page badly.
// Live-routed throughout: the rig subscribes and snaps, nothing rebuilds.

import { FieldKind, ChangeRoute, withDefaults, type ConfigOf, type FieldMap } from '../schema';

/** What the camera frames. The city fills the frame with the whole project;
 *  the gem circles it at a fixed radius, which is what a wallpaper wants. */
export enum CameraTarget {
  City = 'city',
  Gem = 'gem',
}

const TARGET_OPTIONS = [
  { value: CameraTarget.City, label: 'The city' },
  { value: CameraTarget.Gem, label: 'The gem' },
];

export const CAMERA_FIELDS = {
  TARGET: {
    route: ChangeRoute.Live,
    kind: FieldKind.Select,
    default: CameraTarget.City as string,
    options: TARGET_OPTIONS,
    label: 'Frames',
    tip: 'What the opening view fills itself with. The city fits the whole project in frame; the gem holds a fixed orbit around it, close enough to read the buildings behind.',
  },
  ELEVATION: {
    route: ChangeRoute.Live,
    kind: FieldKind.SliderField,
    default: 45,
    min: 0,
    max: 90,
    step: 1,
    label: 'Elevation',
    tip: 'Angle of the camera above the horizon, always looking at the root gem. 90° is straight overhead, 0° is street level.',
  },
  AZIMUTH: {
    route: ChangeRoute.Live,
    kind: FieldKind.SliderField,
    default: 35,
    min: -180,
    max: 180,
    step: 1,
    label: 'Azimuth',
    tip: 'How far the camera swings around the gem, off the main street axis. 0° looks straight down the street.',
  },
  DISTANCE_SCALE: {
    route: ChangeRoute.Live,
    kind: FieldKind.SliderField,
    default: 1,
    min: 0,
    max: 2,
    step: 0.05,
    label: 'Orbit radius',
    tip: 'How far out the camera sits when it frames the gem, in multiples of the distance the city opens at: 1 is exactly that far, 0.5 half, 2 twice. Ignored when the camera frames the city, which fits itself.',
  },
  AUTO_ROTATE: {
    route: ChangeRoute.Live,
    kind: FieldKind.ToggleField,
    default: false,
    label: 'Rotate',
    tip: 'Circle the view around the gem on its own. Held still anyway for anyone whose system asks for reduced motion.',
  },
  ROTATE_SPEED: {
    route: ChangeRoute.Live,
    kind: FieldKind.SliderField,
    default: 0.2,
    min: 0,
    max: 3,
    step: 0.1,
    label: 'Rotation speed',
    tip: 'How fast it circles. 0 holds a still frame.',
  },
} satisfies FieldMap;

export type CameraConfig = ConfigOf<typeof CAMERA_FIELDS>;

/** The camera a wallpaper backdrop opens with: an orbit around the gem, part
 *  way out, turning. The same fields as any camera, at different values. */
export const BACKDROP_CAMERA = {
  TARGET: CameraTarget.Gem as string,
  DISTANCE_SCALE: 0.75,
  AUTO_ROTATE: true,
} satisfies Partial<CameraConfig>;

/** The camera fields with the backdrop's values as their defaults, so a
 *  consumer persisting a second camera gets the right dirty dot and Reset. */
export const BACKDROP_CAMERA_FIELDS = withDefaults(CAMERA_FIELDS, BACKDROP_CAMERA);
