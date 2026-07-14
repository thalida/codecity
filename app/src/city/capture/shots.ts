// city/capture/shots.ts — camera poses for the README screenshot set, keyed by
// the ?shot= name the capture harness reads. Whole-city shots use the rig's
// reset framing at a chosen angle; close-ups use rig.captureView aimed at a
// landmark from rig.captureAnchors. Distances are relative to the city's own
// scale so they hold as the demo repo grows. Debug-only: nothing here runs
// outside the capture harness.
//
// Tuning: every pose reads optional ?elev=&az=&dist= overrides, so you can dial
// a shot in live in the browser (e.g. ?shot=gem&debug&elev=22&az=10&dist=48)
// before baking the numbers in below.

import type { SceneHandle } from '@/state/stores/scene';
import type { Manifest } from '@/types';
import { CAMERA } from '@/state/stores/settings/camera';

/** Set the default-view angle (degrees); the rig re-frames the whole city to
 *  it. Elevation is height above the horizon, azimuth the swing around the gem. */
function angle(elevation: number, azimuth: number): void {
  CAMERA.value = { ...CAMERA.value, ELEVATION: elevation, AZIMUTH: azimuth };
}

/** Live overrides from ?elev=&az=&dist=, undefined when absent/non-numeric. */
export interface ShotOverrides {
  elev?: number;
  az?: number;
  dist?: number;
}

/** Pose the camera for one named shot. */
export type ShotPose = (handle: SceneHandle, manifest: Manifest, o: ShotOverrides) => void;

export const SHOTS: Record<string, ShotPose> = {
  // Whole-city framings: the rig fits the entire city to the chosen angle.
  banner: (h, _m, o) => {
    angle(o.elev ?? 9, o.az ?? 18);
    h.rig.reset();
  },
  overview: (h, _m, o) => {
    angle(o.elev ?? 46, o.az ?? 34);
    h.rig.reset();
  },

  // Close-ups: aim at a landmark, low and near, for a street-level read.
  buildings: (h, _m, o) => {
    const a = h.rig.captureAnchors();
    const target = a.tallestBuilding ?? a.center;
    if (!target) {
      h.rig.reset();
      return;
    }
    target.y *= 0.45; // mid-height of the tallest tower, not its roof
    h.rig.captureView({
      target,
      distance: o.dist ?? a.tallestHeight * 1.5,
      elevation: o.elev ?? 15,
      azimuth: o.az ?? 24,
    });
  },
  streets: (h, m, o) => {
    const a = h.rig.captureAnchors();
    const path = m.stats.maxChildrenDir?.path;
    const street = path ? h.rig.streetAnchor(path) : null;
    const target = street?.pos ?? a.center;
    if (!target) {
      h.rig.reset();
      return;
    }
    // Steep look down over the densest directory's street so the labeled road
    // grid fills the frame, not the gem.
    h.rig.captureView({
      target,
      distance: o.dist ?? a.cityRadius * 0.3,
      elevation: o.elev ?? 64,
      azimuth: o.az ?? 18,
    });
  },
  gem: (h, _m, o) => {
    const a = h.rig.captureAnchors();
    if (!a.gem) {
      h.rig.reset();
      return;
    }
    // Looking down at the floating gem, pulled back so it clears the frame (its
    // size scales with the root street width, so distance does too).
    h.rig.captureView({
      target: a.gem.clone(),
      distance: o.dist ?? Math.max(a.rootStreetWidth * 6, 60),
      elevation: o.elev ?? 46,
      azimuth: o.az ?? 20,
    });
  },

  // trees + fireflies are captured against a bigger, multi-author repo (see
  // app/scripts/screenshots.mjs); codecity itself is too sparse to show either.
  // trees: low and immersive, dense forest fills the foreground with the city
  // behind it; fireflies: tighter on a busy tree so the author orbs read.
  trees: (h, m, o) => {
    const a = h.rig.captureAnchors();
    const sha = m.stats.maxFilesPerCommit?.sha;
    const tree = sha ? h.rig.treeAnchor(sha) : null;
    const target = tree?.pos ?? a.center;
    if (!target) {
      h.rig.reset();
      return;
    }
    h.rig.captureView({
      target,
      distance: o.dist ?? (tree ? tree.radius * 6 : a.cityRadius * 0.5),
      elevation: o.elev ?? 20,
      azimuth: o.az ?? 30,
    });
  },
  fireflies: (h, m, o) => {
    const sha = m.stats.maxFilesPerCommit?.sha;
    const tree = sha ? h.rig.treeAnchor(sha) : null;
    if (!tree) {
      h.rig.reset();
      return;
    }
    h.rig.captureView({
      target: tree.pos,
      distance: o.dist ?? Math.max(tree.radius * 2, 18),
      elevation: o.elev ?? 12,
      azimuth: o.az ?? 30,
    });
  },
};

export type ShotName = keyof typeof SHOTS;
