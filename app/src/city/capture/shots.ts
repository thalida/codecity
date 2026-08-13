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
import { TIMELINE_MODE, SCRUB_MAX, TIMELINE_BUNDLE, setScrubPos } from '@/state/stores/timeline';
import { loadTimelineScene } from '@/hooks/useTimelineMode';

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

/** Pose the camera for one named shot. Return `false` when the shot's target
 *  isn't ready yet (e.g. trees still placing) so the harness retries; any other
 *  return (void/true) means posed. */
export type ShotPose = (
  handle: SceneHandle,
  manifest: Manifest,
  o: ShotOverrides
) => boolean | void;

/** An actually-placed tree's bounds, or null if none are placed yet.
 *  treeAnchor(sha) is null for commits the layout didn't place a tree for, so a
 *  specific stat sha (e.g. the busiest commit) often misses. Walk commits
 *  most-authors-first so the tree we land on also has the most firefly orbs. */
function placedTree(handle: SceneHandle, manifest: Manifest) {
  const byAuthors = [...manifest.commits].sort((x, y) => y.authors.length - x.authors.length);
  for (const c of byAuthors) {
    const tree = handle.rig.treeAnchor(c.sha);
    if (tree) return tree;
  }
  return null;
}

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

// Fire loadTimelineScene() exactly once across the timeline shot's pose retries
// (it's async; the harness re-invokes the pose until it returns non-false).
let _timelineKickedOff = false;

export const SHOTS: Record<string, ShotPose> = {
  // Low side-on skyline. Aim just above the gem (toward the floating repo
  // label) and pull in close so the label reads and stays framed.
  banner: (handle, _m, o) => {
    const anchors = handle.rig.captureAnchors();
    const base = anchors.gem ?? anchors.center;
    if (!base) {
      handle.rig.reset();
      return;
    }
    const target = base.clone();
    target.y += anchors.cityRadius * 0.12; // lift toward the label so it stays in frame
    handle.rig.captureView({
      target,
      distance: o.dist ?? anchors.cityRadius * 0.55,
      elevation: o.elev ?? 9,
      azimuth: o.az ?? 12,
    });
  },
  // Whole-city framing: the rig fits the entire city to the chosen angle.
  overview: (handle, _m, o) => {
    angle(o.elev ?? 46, o.az ?? 34);
    handle.rig.reset();
  },

  // The whole city part-built at an older commit: enter Timeline mode, scrub to
  // mid-history, and frame the union city. No settings overrides — the shot
  // reflects the defaults (deleted stubs on). loadTimelineScene
  // is async, so return false until the mode + bundle are live — the harness retries.
  timeline: (handle, _m, o) => {
    if (!TIMELINE_MODE.peek()) {
      if (!_timelineKickedOff) {
        _timelineKickedOff = true;
        void loadTimelineScene();
      }
      return false;
    }
    const bundle = TIMELINE_BUNDLE.peek();
    if (!bundle || bundle.commits.length === 0) return false;
    setScrubPos(Math.floor(SCRUB_MAX.peek() * 0.5));
    angle(o.elev ?? 44, o.az ?? 32);
    handle.rig.reset();
  },

  // Close-up on the street whose buildings span the most file types (hue =
  // extension), for the widest spread of colors. The gem may be in view.
  buildings: (handle, manifest, o) => {
    const anchors = handle.rig.captureAnchors();
    const path = mostColorfulDirPath(manifest.tree);
    const street = path ? handle.rig.streetAnchor(path) : null;
    const target = street?.pos ?? anchors.tallestBuilding ?? anchors.center;
    if (!target) {
      handle.rig.reset();
      return;
    }
    if (street) target.y = anchors.tallestHeight * 0.25; // look at building mid-height, not the road
    handle.rig.captureView({
      target,
      distance: o.dist ?? anchors.tallestHeight * 1.6,
      elevation: o.elev ?? 16,
      azimuth: o.az ?? 24,
    });
  },
  streets: (handle, manifest, o) => {
    const anchors = handle.rig.captureAnchors();
    const path = manifest.stats.maxChildrenDir?.path;
    const street = path ? handle.rig.streetAnchor(path) : null;
    const target = street?.pos ?? anchors.center;
    if (!target) {
      handle.rig.reset();
      return;
    }
    // Steep look down over the densest directory's street so the labeled road
    // grid fills the frame, not the gem.
    handle.rig.captureView({
      target,
      distance: o.dist ?? anchors.cityRadius * 0.3,
      elevation: o.elev ?? 64,
      azimuth: o.az ?? 18,
    });
  },
  gem: (handle, _m, o) => {
    const anchors = handle.rig.captureAnchors();
    if (!anchors.gem) {
      handle.rig.reset();
      return;
    }
    // Looking down at the floating gem, pulled back so it clears the frame (its
    // size scales with the root street width, so distance does too).
    handle.rig.captureView({
      target: anchors.gem.clone(),
      distance: o.dist ?? Math.max(anchors.rootStreetWidth * 6, 60),
      elevation: o.elev ?? 46,
      azimuth: o.az ?? 20,
    });
  },

  // Demo video: self-drive one smooth turn of the whole city, marking
  // <html data-cc-orbit-start> / <html data-cc-orbit-done> so demo-video.mjs
  // knows which slice of its recording to keep. Time-based, so the duration
  // holds regardless of frame rate, and a full 360deg loops seamlessly.
  // Tuning: ?elev = view angle, ?dist = distance, ?az = seconds per turn.
  orbit: (handle, _m, o) => {
    const anchors = handle.rig.captureAnchors();
    const target = anchors.gem ?? anchors.center;
    if (!target) return false;
    const anchor = target.clone();
    const elevation = o.elev ?? 30;
    const distance = o.dist ?? anchors.cityRadius * 0.95;
    const durationMs = (o.az ?? 24) * 1000;
    let startMs: number | null = null;
    const step = (nowMs: number): void => {
      if (startMs === null) {
        startMs = nowMs;
        document.documentElement.dataset.ccOrbitStart = '1';
      }
      const p = Math.min((nowMs - startMs) / durationMs, 1);
      handle.rig.captureView({
        target: anchor.clone(),
        distance,
        elevation,
        azimuth: -180 + p * 360,
      });
      if (p >= 1) {
        document.documentElement.dataset.ccOrbitDone = '1';
        return;
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  },

  // trees + fireflies are captured against a bigger, multi-author repo (see
  // app/scripts/screenshots.mjs); codecity itself is too sparse to show either.
  // trees: wide forest immersion (dense trees fill the foreground, city behind);
  // fireflies: tighter on a busy tree so the author orbs read.
  trees: (handle, manifest, o) => {
    const anchors = handle.rig.captureAnchors();
    const tree = placedTree(handle, manifest);
    if (!tree) return false; // trees not placed yet: retry
    // Wide, low pull-back over a forest tree (distance scales with the city, not
    // the tree's canopy) so the forest fills the foreground with the city behind.
    handle.rig.captureView({
      target: tree.pos,
      distance: o.dist ?? anchors.cityRadius * 0.16,
      elevation: o.elev ?? 9,
      azimuth: o.az ?? 30,
    });
  },
  fireflies: (handle, manifest, o) => {
    const tree = placedTree(handle, manifest);
    if (!tree) return false; // trees not placed yet: retry
    // Fit the tree's bounding sphere to the view (same math as the rig's
    // focusTree) at a low angle, so the single tree fills the frame.
    const span = tree.radius * 2;
    const boundingRadius = 0.5 * Math.sqrt(span * span * 2 + tree.height * tree.height);
    tree.pos.y = tree.height * 0.85;
    handle.rig.captureView({
      target: tree.pos,
      distance: o.dist, // omitted -> fit the bounding sphere below
      fitRadius: boundingRadius,
      padding: 2.2,
      elevation: o.elev ?? 4,
      azimuth: o.az ?? 30,
    });
  },
};
