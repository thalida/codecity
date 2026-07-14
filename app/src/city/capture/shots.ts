// city/capture/shots.ts — camera poses for the README screenshot set, keyed by
// the ?shot= name the capture harness reads. Each pose reuses the real rig
// (reset / focus) and picks its subject from the manifest's precomputed
// leaderboards, so the shots stay stable as the demo repo grows. Debug-only:
// nothing here runs outside the capture harness.

import type { SceneHandle } from '@/state/stores/scene';
import type { Manifest } from '@/types';
import { CAMERA } from '@/state/stores/settings/camera';

/** Set the default-view angle (degrees); the rig re-frames the whole city to
 *  it. Elevation is height above the horizon, azimuth the swing around the gem. */
function angle(elevation: number, azimuth: number): void {
  CAMERA.value = { ...CAMERA.value, ELEVATION: elevation, AZIMUTH: azimuth };
}

/** Pose the camera for one named shot: set the angle and/or focus a landmark. */
export type ShotPose = (handle: SceneHandle, manifest: Manifest) => void;

export const SHOTS: Record<string, ShotPose> = {
  // Whole-city framings: pick an angle, snap the rig to it.
  banner: (h) => {
    angle(9, 18);
    h.rig.reset();
  },
  overview: (h) => {
    angle(46, 34);
    h.rig.reset();
  },
  trees: (h) => {
    angle(19, 128);
    h.rig.reset();
  },
  gem: (h) => {
    angle(13, 0);
    h.rig.reset();
  },
  // Subject framings: focus a landmark chosen from the manifest leaderboards.
  buildings: (h, m) => {
    const path = m.stats.maxLinesFile?.path;
    if (path) h.focusByPath(path);
    else h.rig.reset();
  },
  streets: (h, m) => {
    const path = m.stats.maxChildrenDir?.path;
    if (path) h.focusByPath(path);
    else h.rig.reset();
  },
  fireflies: (h, m) => {
    const sha = m.stats.maxFilesPerCommit?.sha;
    if (sha) h.rig.focusTree(sha);
    else h.rig.reset();
  },
};

export type ShotName = keyof typeof SHOTS;
