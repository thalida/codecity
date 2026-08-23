// city/capture/shots.ts — camera poses for the README shots, keyed by ?shot=.
// Distances are relative to the city's own scale, so they hold as the demo repo
// grows, and every pose reads ?elev=&az=&dist= overrides so a shot can be dialled
// in live before the numbers are baked in. Debug-only.

import type { CityScene } from '@/city/types';
import { NodeKind, type Manifest, type DirNode } from '@/types';
import { CAMERA } from '@/state/settings/fields/camera';
import { CameraMode } from '@/city/render/cameraRig';
import type { CitySession } from '@/state/city/session';

/** This city's default-view angle in degrees, which the rig re-frames to. The
 *  panel's own values are left alone: a shot poses one city, not the app. */
function angle(session: CitySession, elevation: number, azimuth: number): void {
  session.config.override(CAMERA, {
    ...session.config.CAMERA.peek(),
    ELEVATION: elevation,
    AZIMUTH: azimuth,
  });
}

/** Live overrides from ?elev=&az=&dist=, undefined when absent/non-numeric. */
export interface ShotOverrides {
  elev?: number;
  az?: number;
  dist?: number;
}

/** Pose the camera for one shot. false when its target isn't ready yet, which
 *  is the harness's cue to retry. */
export type ShotPose = (
  handle: CityScene,
  manifest: Manifest,
  o: ShotOverrides,
  /** The project being shot: its history, for a shot that scrubs. */
  session: CitySession
) => boolean | void;

/** A placed tree's bounds. A named commit often has no tree, so this walks
 *  commits most-authors-first: the one it lands on carries the most orbs. */
function placedTree(handle: CityScene, manifest: Manifest) {
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
  overview: (handle, _m, o, session) => {
    angle(session, o.elev ?? 46, o.az ?? 34);
    handle.rig.reset();
  },

  // The landing's wallpaper (`just hero-image`), shot from the backdrop's own
  // pose: the landing swaps this image for a live backdrop city.
  hero: (handle) => {
    if (!handle.rig.captureAnchors().gem) return false; // no city yet
    // Still: a capture wants the frame the turntable opens on, not wherever a
    // spin happened to be when the shutter fell.
    handle.rig.setMode(CameraMode.Backdrop, { autoRotate: false });
  },

  // The city part-built, at the defaults. The load is async, so this returns
  // false until the mode and bundle are live and the harness retries.
  timeline: (handle, _m, o, session) => {
    const timeline = session.timeline;
    if (!timeline.mode.peek()) {
      if (!_timelineKickedOff) {
        _timelineKickedOff = true;
        void session.timelineMode.loadScene();
      }
      return false;
    }
    const bundle = timeline.bundle.peek();
    if (!bundle || bundle.commits.length === 0) return false;
    timeline.setScrubPos(Math.floor(timeline.scrubMax.peek() * 0.5));
    angle(session, o.elev ?? 44, o.az ?? 32);
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

  // One turn, marked on <html> so demo-video knows which slice to keep.
  // Time-based, so the duration holds whatever the frame rate.
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

  // Both shot against a bigger, multi-author repo: codecity itself is too
  // sparse to show either a forest or a busy tree's orbs.
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
