// state/stores/settings/camera.ts — the default framing. The camera always looks
// at the root gem, and these set where it looks from. Live: the rig subscribes
// and snaps to the pose itself, so nothing rebuilds.

import {
  settingSignal,
  FieldKind,
  ChangeRoute,
  type ConfigOf,
  type FieldMap,
} from '@/state/settingsSchema';

const CAMERA_FIELDS = {
  ELEVATION: {
    route: ChangeRoute.Live,
    kind: FieldKind.Slider,
    default: 45,
    min: 0,
    max: 90,
    step: 1,
    label: 'Elevation',
    tip: 'Angle of the default camera above the horizon, always looking at the root gem. 90° is straight overhead.',
  },
  AZIMUTH: {
    route: ChangeRoute.Live,
    kind: FieldKind.Slider,
    default: 35,
    min: -180,
    max: 180,
    step: 1,
    label: 'Azimuth',
    tip: 'How far the default camera swings around the gem, off the main street axis. 0° looks straight down the street.',
  },
} satisfies FieldMap;

export const CAMERA = settingSignal('CAMERA', CAMERA_FIELDS);
export type CameraConfig = ConfigOf<typeof CAMERA_FIELDS>;
