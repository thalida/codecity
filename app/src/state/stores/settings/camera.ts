// state/stores/settings/camera.ts — the default camera framing angle. The
// camera always looks at the root gem; these two angles set the direction it
// views from. Autosave (write-through) so dragging a slider re-frames live —
// the cameraRig subscribes to this store and snaps to the new pose.
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

const CAMERA_FIELDS = {
  ELEVATION: {
    route: ChangeRoute.Live,
    kind: FieldKind.Slider,
    default: 44,
    min: 0,
    max: 90,
    step: 1,
    label: 'Elevation',
    tip: 'Angle of the default camera above the horizon, always looking at the root gem. 90° is straight overhead.',
  },
  AZIMUTH: {
    route: ChangeRoute.Live,
    kind: FieldKind.Slider,
    default: 17,
    min: -180,
    max: 180,
    step: 1,
    label: 'Azimuth',
    tip: 'How far the default camera swings around the gem, off the main street axis. 0° looks straight down the street.',
  },
} satisfies FieldMap;

export const CAMERA = settingSignal('CAMERA', CAMERA_FIELDS);
markAutosave(CAMERA);
export type CameraConfig = ConfigOf<typeof CAMERA_FIELDS>;
