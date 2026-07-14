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

import * as THREE from 'three';

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
  streets: (h, _m, o) => {
    const a = h.rig.captureAnchors();
    const target = a.gem ? new THREE.Vector3(a.gem.x, 0, a.gem.z) : a.center;
    if (!target) {
      h.rig.reset();
      return;
    }
    // Angled down over the central intersection, close enough that the road
    // labels stay legible.
    h.rig.captureView({
      target,
      distance: o.dist ?? a.cityRadius * 0.4,
      elevation: o.elev ?? 56,
      azimuth: o.az ?? 20,
    });
  },
  gem: (h, _m, o) => {
    const a = h.rig.captureAnchors();
    if (!a.gem) {
      h.rig.reset();
      return;
    }
    h.rig.captureView({
      target: a.gem.clone(),
      distance: o.dist ?? Math.max(a.tallestHeight * 0.25, 30),
      elevation: o.elev ?? 20,
      azimuth: o.az ?? 12,
    });
  },

  // trees + fireflies are data-limited on the codecity repo (few commits, one
  // main author), so these stay whole-city framings until they point at a
  // bigger, multi-author repo. See app/scripts/screenshots.mjs.
  trees: (h, _m, o) => {
    angle(o.elev ?? 24, o.az ?? 128);
    h.rig.reset();
  },
  fireflies: (h, _m, o) => {
    angle(o.elev ?? 20, o.az ?? 150);
    h.rig.reset();
  },
};

export type ShotName = keyof typeof SHOTS;
