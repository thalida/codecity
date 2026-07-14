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
import { NodeKind, type Manifest, type DirNode } from '@/types';
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

/** Directory (path) whose direct file children span the most distinct
 *  extensions: the most color-varied street, since building hue = extension. */
function mostColorfulDirPath(root: DirNode): string | null {
  let bestPath: string | null = null;
  let bestColors = 0;
  let bestFiles = 0;
  const visit = (dir: DirNode): void => {
    const exts = new Set<string>();
    let files = 0;
    for (const child of dir.children) {
      if (child.type === NodeKind.File) {
        files += 1;
        exts.add(child.extension);
      } else {
        visit(child);
      }
    }
    if (files > 0 && (exts.size > bestColors || (exts.size === bestColors && files > bestFiles))) {
      bestPath = dir.path;
      bestColors = exts.size;
      bestFiles = files;
    }
  };
  visit(root);
  return bestPath;
}

export const SHOTS: Record<string, ShotPose> = {
  // Low side-on skyline. Aim just above the gem (toward the floating repo
  // label) and pull in close so the label reads and stays framed.
  banner: (h, _m, o) => {
    const a = h.rig.captureAnchors();
    const base = a.gem ?? a.center;
    if (!base) {
      h.rig.reset();
      return;
    }
    const target = base.clone();
    target.y += a.cityRadius * 0.12; // lift toward the label so it stays in frame
    h.rig.captureView({
      target,
      distance: o.dist ?? a.cityRadius * 0.55,
      elevation: o.elev ?? 9,
      azimuth: o.az ?? 12,
    });
  },
  // Whole-city framing: the rig fits the entire city to the chosen angle.
  overview: (h, _m, o) => {
    angle(o.elev ?? 46, o.az ?? 34);
    h.rig.reset();
  },

  // Close-up on the street whose buildings span the most file types (hue =
  // extension), for the widest spread of colors. The gem may be in view.
  buildings: (h, m, o) => {
    const a = h.rig.captureAnchors();
    const path = mostColorfulDirPath(m.tree);
    const street = path ? h.rig.streetAnchor(path) : null;
    const target = street?.pos ?? a.tallestBuilding ?? a.center;
    if (!target) {
      h.rig.reset();
      return;
    }
    if (street) target.y = a.tallestHeight * 0.25; // look at building mid-height, not the road
    h.rig.captureView({
      target,
      distance: o.dist ?? a.tallestHeight * 1.6,
      elevation: o.elev ?? 16,
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
  // trees: wide forest immersion (dense trees fill the foreground, city behind);
  // fireflies: tighter on a busy tree so the author orbs read.
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
      distance: o.dist ?? Math.max(tree.radius * 3, 45),
      elevation: o.elev ?? 12,
      azimuth: o.az ?? 30,
    });
  },
};

export type ShotName = keyof typeof SHOTS;
