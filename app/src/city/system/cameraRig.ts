// scene/system/cameraRig.ts — owns the perspective camera, OrbitControls,
// initial framing, and the focus/reset animations (R key reset,
// F key focus-on-selection, dblclick focus).
//
// Public contract:
//
//   const rig = createCameraRig({ canvas, world });
//
//   rig.camera                            // PerspectiveCamera (read-only ref)
//   rig.controls                          // OrbitControls    (read-only ref)
//   rig.update(dtMs)                      // per-frame from animate loop
//   rig.reset()                           // R key
//   rig.recenterTo(worldPoint)            // dblclick on empty space
//   rig.focusBuilding(mesh, building)     // F or dblclick on a building
//   rig.focusStreet(street, hitPoint)     // dblclick on a street
//   rig.focusTree(sha)                    // F or dblclick on a tree (commit)
//   rig.focusSelection(pickTarget)        // dispatches to one of the above
//                                         //   based on the PickTarget kind
//   rig.dispose()
//
// First-frame framing is one-shot by construction: frameToBbox is not on
// the public API. update() runs the framing internally when an internal
// firstFrame flag is true and world.getBbox() returns non-empty,
// then clears the flag. There's no surface for an accidental re-frame.
//
// Camera pose is never persisted. Every world load always starts at the
// default gem-framing position.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  CAMERA_FOV,
  CAMERA_NEAR,
  CAMERA_FAR,
  CAMERA_DAMPING_FACTOR,
  CAMERA_MAX_POLAR_ANGLE_FRAC,
  CAMERA_MIN_DISTANCE,
  CAMERA_MAX_DISTANCE_MULT,
  CAMERA_INITIAL_DISTANCE_MULT,
  CAMERA_BASE_DURATION_MS,
  CAMERA_EASING_POWER,
} from '@/constants/camera';
import { NodeKind, StreetAxis } from '@/types';
import type { Building, PickTarget, Street } from '@/types';
import type { createWorld } from '../world';

/** Floor on controls.maxDistance regardless of city size. Tiny-but-tall
 *  cities (small footprint, one big building) end up with a tiny
 *  worldRadius if Y is the only large axis — and on cities with little
 *  geometry at all, worldRadius is near zero. This guarantees the user
 *  can always pull back to a comfortable cinematic viewing distance. */
const MIN_MAX_DISTANCE = 8000;

// Per-action duration ratios relative to CAMERA_BASE_DURATION_MS.
// These tune the per-gesture feel — a Recenter should feel snappier than a
// building-focus tween, etc. Multiplied by BASE_DURATION_MS at action time
// so dragging the base in Settings scales every camera animation in lock-
// step while preserving the relative pacing.
//   RECENTER (0.7×) — quick pivot slide, no zoom change
//   BUILDING_FOCUS (1.2×) — longer, gives the user time to read the tween
//   STREET_FOCUS  (1.2×) — same character as building-focus
const RECENTER_RATIO = 0.7;
const BUILDING_FOCUS_RATIO = 1.2;
const STREET_FOCUS_RATIO = 1.2;

// Top-down focus framing (replaces door-facing + altitude-floor logic).
// 80° elevation gives the user a near-overhead read while still showing
// enough side-faces for 3D depth. Stays under controls.maxPolarAngle.
const TOP_DOWN_ELEVATION_DEG = 80;
const TOP_DOWN_PADDING_MULT = 2.8;

// y-component of the start framing direction vector (before normalization).
// Combined with FRAMING_DIR_LATERAL below: with lateral=0.3, y=1.0 gives
// ~43.7° elevation.
const FRAMING_DIR_Y = 1.0;

// Lateral component on the framing direction vector — perpendicular to
// the root street's long axis. Adds an isometric-style off-axis tilt so
// the camera doesn't look straight down the road; both sides of the
// street read in 3D instead of stacking face-on. 0.3 → ~15° lateral
// angle from the street axis.
const FRAMING_DIR_LATERAL = 0.3;

// Headroom above the tallest building's roof when fitting the start
// framing. 1.0 = spire flush at the top edge of the vertical FOV
// (tightest geometric fit). 1.05 leaves ~5% of the vertical FOV as
// sky above the tallest spire so the roof doesn't touch the very top.
const TALLEST_BUILDING_HEADROOM_MULT = 1.05;

export function createCameraRig({
  canvas,
  world,
}: {
  canvas: HTMLCanvasElement;
  world: ReturnType<typeof createWorld>;
}) {
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;
  const camera = new THREE.PerspectiveCamera(
    CAMERA_FOV,
    W / Math.max(1, H),
    CAMERA_NEAR,
    CAMERA_FAR
  );

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = CAMERA_DAMPING_FACTOR;
  controls.screenSpacePanning = false;
  controls.zoomToCursor = true;
  controls.maxPolarAngle = Math.PI * CAMERA_MAX_POLAR_ANGLE_FRAC;
  controls.minDistance = CAMERA_MIN_DISTANCE;
  controls.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.PAN,
  };

  let firstFrame = true;
  let initialCamPos: THREE.Vector3 | null = null;
  let initialTarget: THREE.Vector3 | null = null;

  let _rebuildSubscribed = false;

  // Animation cancellation token. Each new focus/reset animation bumps
  // this; in-flight rAF steps abort if their token doesn't match.
  let camAnimToken = 0;

  // Compute the canonical "framed" pose for the current world bbox and
  // refresh initialCamPos/initialTarget + controls.maxDistance + the
  // OrbitControls saveState snapshot. Does NOT move the user's camera.
  // Called on first frame and after every manifest swap so reset() always
  // snaps to a pose that fits the current city — without this, a manifest
  // swap after zooming way out could leave R targeting the OLD (large-city)
  // framing while the camera was far outside the new bbox.
  function _captureFraming(): boolean {
    const bbox = world.getBbox();
    if (!bbox || bbox.isEmpty()) return false;

    // World-bbox metrics — drive controls.maxDistance + camera.far so the
    // user can zoom all the way out and see the whole city without it
    // being clipped by the far plane.
    const worldCenter = new THREE.Vector3();
    bbox.getCenter(worldCenter);
    const worldGroundCenter = new THREE.Vector3(worldCenter.x, 0, worldCenter.z);
    const farX = Math.max(
      Math.abs(bbox.max.x - worldGroundCenter.x),
      Math.abs(bbox.min.x - worldGroundCenter.x)
    );
    const farY = Math.max(
      Math.abs(bbox.max.y - worldGroundCenter.y),
      Math.abs(bbox.min.y - worldGroundCenter.y)
    );
    const farZ = Math.max(
      Math.abs(bbox.max.z - worldGroundCenter.z),
      Math.abs(bbox.min.z - worldGroundCenter.z)
    );
    const worldRadius = Math.sqrt(farX * farX + farY * farY + farZ * farZ);
    const halfFov = (camera.fov * Math.PI) / 180 / 2;

    // Max zoom-out: a generous multiple of the world's geometric
    // radius (which includes building heights via farY), floored at
    // an absolute minimum so tiny-but-tall cities still let the user
    // pull back. Decoupled from worldDist / FOV so the behavior is
    // predictable regardless of city shape. Comment-on-history: the
    // previous formula was worldDist × MAX_DISTANCE_MULT which kept
    // small cities cramped because worldDist was itself small.
    controls.maxDistance = Math.max(worldRadius * CAMERA_MAX_DISTANCE_MULT, MIN_MAX_DISTANCE);

    // Far clip: covers the farthest point a fully-zoomed-out camera can
    // see (maxDistance past target, plus the world's own radius). Set
    // unconditionally so it shrinks for small worlds (depth-buffer
    // precision matters for the hover-ghost inset) AND grows for huge
    // worlds. Floored at the Cyberpunk Valley sky-sphere's outer extent
    // (CAMERA_PERSPECTIVE.FAR × 0.95) so the sphere never gets clipped
    // at the corners of small-repo viewports.
    const dynamicFar = controls.maxDistance * 2 + worldRadius * 2;
    const skySphereExtent = CAMERA_FAR * 0.95;
    camera.far = Math.max(dynamicFar, skySphereExtent);
    camera.updateProjectionMatrix();

    // Framing target: the root gem, with a distance sized to the root
    // street rather than the whole-world bbox. R should land the user
    // looking at the gem with the root street + its immediate
    // neighborhood readable on screen — not zoomed all the way out where
    // the gem becomes an invisible dot in a sprawling metropolis.
    const gemPos = world.getGemWorldPos();
    const rootStreet = world.getRootStreet();
    let framingCenter: THREE.Vector3;
    let framingRadius: number;
    if (gemPos && rootStreet) {
      framingCenter = new THREE.Vector3(gemPos.x, 0, gemPos.z);
      // Frame off the root street's WIDTH, not its length. Length is a
      // proxy for "how much stuff is in the project" — for a big repo the
      // root street is enormously long and framing on it is the same as
      // framing the whole world. Width is bounded by STREET_TIERS (≈10–52),
      // so width × 15 reliably fits the gem + the road's first stretch
      // regardless of project size.
      framingRadius = rootStreet.width * 15;
    } else {
      // No gem (empty manifest, pre-build) — fall back to whole-world.
      framingCenter = worldGroundCenter;
      framingRadius = worldRadius;
    }
    // Distance from width: the existing "city neighborhood readable on
    // screen" framing. INITIAL_DISTANCE_MULT (<1) tightens the sphere fit
    // intentionally; tuned for the typical city shape.
    const widthDist = (framingRadius / Math.sin(halfFov)) * CAMERA_INITIAL_DISTANCE_MULT;
    // Default framing direction: place the camera BEHIND the gem along
    // the root street's long axis (the street extends in +X for X-oriented
    // or +Z for Y-oriented; the gem sits at the low end — see
    // city/components/gem/mesh.ts:createRootGem) at a moderate elevation with a slight
    // lateral offset so the view reads as 3D oblique rather than face-on
    // down the road. FRAMING_DIR_Y (1.0) → ~44° elevation after the
    // lateral mix; FRAMING_DIR_LATERAL (0.3) → ~15° azimuth off the
    // street axis. Fallback (no gem) keeps the old high-oblique direction.
    let dir: THREE.Vector3;
    if (rootStreet) {
      dir =
        rootStreet.orientation === StreetAxis.X
          ? new THREE.Vector3(-1, FRAMING_DIR_Y, FRAMING_DIR_LATERAL).normalize()
          : new THREE.Vector3(FRAMING_DIR_LATERAL, FRAMING_DIR_Y, -1).normalize();
    } else {
      dir = new THREE.Vector3(-1, 1, 1).normalize();
    }

    // Height fit: project the tallest building's 4 roof corners through
    // the camera math and find the minimum D such that they all sit
    // within the vertical FOV. One building, 4 corners — no loop over
    // the whole city.
    //
    // For a point p offset from the target, the camera at target + dir·D
    // sees screen-y = (p · cam_up) / (D − p · dir), where cam_up is
    // perpendicular to dir and aligned with world up. Setting
    // |screen-y| ≤ tan(halfFov) and solving:
    //
    //   D ≥ |p · cam_up| / tan(halfFov) + p · dir
    //
    // Take the max across the 4 roof corners. HEADROOM scales D up for
    // breathing room above the roof (1.0 = spire flush against top edge).
    let heightDist = 0;
    const tallest = gemPos && rootStreet ? world.getTallestBuilding() : null;
    const labelBounds = gemPos && rootStreet ? world.getRepoLabelBounds() : null;
    if (tallest || labelBounds) {
      const sinElev = dir.y;
      const camUpScale = Math.sqrt(Math.max(0, 1 - sinElev * sinElev));
      const camUpX = camUpScale > 1e-6 ? (-dir.y * dir.x) / camUpScale : 0;
      const camUpY = camUpScale > 1e-6 ? camUpScale : 1;
      const camUpZ = camUpScale > 1e-6 ? (-dir.y * dir.z) / camUpScale : 0;
      const tanHalfFov = Math.tan(halfFov);
      const gemX = framingCenter.x;
      const gemZ = framingCenter.z;
      const _fitPoint = (wx: number, wy: number, wz: number) => {
        const px = wx - gemX;
        const py = wy;
        const pz = wz - gemZ;
        const pDotDir = px * dir.x + py * dir.y + pz * dir.z;
        const pDotUp = px * camUpX + py * camUpY + pz * camUpZ;
        const dNeeded = Math.abs(pDotUp) / tanHalfFov + pDotDir;
        if (dNeeded > heightDist) heightDist = dNeeded;
      };
      // Position-independent height fit: use gem coords instead of the
      // tallest building's real coords. The fit math adds p·dir, so a
      // tall outlier 2000u from the gem would push the camera back
      // ~2000u just to literally frame that one roof on screen — which
      // is exactly the "starts zoomed all the way out to fit a far-away
      // spire" bug. The default view just needs D large enough that a
      // building of this HEIGHT could fit; the user pans/orbits to
      // actually look at the outlier.
      if (tallest) {
        for (const sx of [-0.5, 0.5]) {
          for (const sz of [-0.5, 0.5]) {
            _fitPoint(gemX + sx * tallest.w, tallest.h, gemZ + sz * tallest.d);
          }
        }
      }
      // Include the floating repo-label panel so empty worlds (no
      // buildings) still frame to show the label, and crowded worlds
      // never crop it off the top edge. The panel billboards to face
      // the camera, so its horizontal extent could rotate either way —
      // sample the top corners along BOTH world axes to bound it.
      if (labelBounds) {
        const topY = labelBounds.centerY + labelBounds.halfHeight;
        const r = labelBounds.halfWidth;
        for (const [dx, dz] of [
          [-r, 0],
          [r, 0],
          [0, -r],
          [0, r],
        ]) {
          _fitPoint(labelBounds.centerX + dx, topY, labelBounds.centerZ + dz);
        }
      }
      heightDist *= TALLEST_BUILDING_HEADROOM_MULT;
    }
    const framingDist = Math.max(widthDist, heightDist);

    initialCamPos = framingCenter.clone().add(dir.multiplyScalar(framingDist));
    initialTarget = framingCenter.clone();

    // Update OrbitControls' saveState (used by controls.reset()) without
    // disturbing the user's current view: stash, swap to framed pose,
    // saveState, restore. saveState reads camera.position + target + zoom
    // at call time, so this is the only way to reframe controls.reset()'s
    // target without re-positioning the user.
    const userPos = _scratchUserPos.copy(camera.position);
    const userTarget = _scratchUserTarget.copy(controls.target);
    camera.position.copy(initialCamPos);
    controls.target.copy(initialTarget);
    controls.saveState();
    camera.position.copy(userPos);
    controls.target.copy(userTarget);
    return true;
  }

  // Reusable scratch — _captureFraming runs on every world rebuild.
  const _scratchUserPos = new THREE.Vector3();
  const _scratchUserTarget = new THREE.Vector3();

  function _frameToBbox() {
    if (!_captureFraming() || !initialCamPos || !initialTarget) return false;

    // First-frame only: move the camera to the default framed pose.
    camera.position.copy(initialCamPos);
    camera.lookAt(initialTarget);
    controls.target.copy(initialTarget);

    // Re-frame on every manifest swap so R (reset) always fits the current
    // city. The decision to actually SNAP the camera on a source change lives
    // in the render layer (useCityScene), which calls reset() explicitly — this
    // rig is source-agnostic.
    if (!_rebuildSubscribed) {
      world.onChange(() => {
        _captureFraming();
      });
      _rebuildSubscribed = true;
    }
    return true;
  }

  function update(_dtMs: number): void {
    if (firstFrame) {
      if (_frameToBbox()) firstFrame = false;
    }
    controls.update();
  }

  function _animateCamera(
    newTarget: THREE.Vector3,
    newCamPos: THREE.Vector3,
    duration: number
  ): void {
    const token = ++camAnimToken;
    const startTarget = controls.target.clone();
    const startCamPos = camera.position.clone();
    const t0 = performance.now();
    const easingPower = CAMERA_EASING_POWER;

    function step() {
      if (camAnimToken !== token) return;
      const elapsed = performance.now() - t0;
      let t = elapsed / duration;
      if (t >= 1) t = 1;
      const eased = 1 - Math.pow(1 - t, easingPower);
      controls.target.lerpVectors(startTarget, newTarget, eased);
      camera.position.lerpVectors(startCamPos, newCamPos, eased);
      if (t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function reset() {
    // If framing wasn't captured yet (or was cleared by a disposal cycle),
    // try once more before giving up — silent no-op on R is worse than
    // re-running the cheap framing computation. Returns false only when
    // the city has no bbox at all (e.g., pre-manifest), in which case
    // there's nothing to reset to.
    if (!initialCamPos || !initialTarget) {
      if (!_captureFraming()) return;
      if (!initialCamPos || !initialTarget) return;
    }
    // Cancel any in-flight focus/reset animation so it can't keep
    // walking the camera away from the snap target.
    camAnimToken++;
    camera.up.set(0, 1, 0);
    // Hard snap. Bypassing controls.reset() in favor of a manual snap
    // because controls.reset() calls update() at the end, which re-applies
    // any residual sphericalDelta / panOffset / scale from the user's last
    // interaction — visible as the camera drifting back toward the
    // pre-reset pose, especially when the framed pose is far from where
    // the user was (e.g. R after a manifest swap going from a close-up
    // small world to a far-out big world). Disabling damping during the
    // snap consumes those deltas in one frame at full strength, then we
    // re-enable damping for normal use.
    const wasDamping = controls.enableDamping;
    controls.enableDamping = false;
    camera.position.copy(initialCamPos);
    controls.target.copy(initialTarget);
    camera.lookAt(initialTarget);
    controls.update();
    controls.enableDamping = wasDamping;
    // Refresh saveState so subsequent controls.reset() calls (e.g. from
    // a future canceled focus tween) snap to the now-current pose.
    controls.saveState();
  }

  // Slide pivot to p; camera shifts by the same delta so the visible
  // scene doesn't zoom or rotate, just slides under.
  function recenterTo(p: THREE.Vector3): void {
    camera.up.set(0, 1, 0);
    const delta = p.clone().sub(controls.target);
    _animateCamera(
      p.clone(),
      camera.position.clone().add(delta),
      CAMERA_BASE_DURATION_MS * RECENTER_RATIO
    );
  }

  const _scratchDir = new THREE.Vector3();

  function _focusTopDown(
    center: THREE.Vector3,
    fitW: number,
    fitD: number,
    fitH: number,
    durationRatio: number
  ): void {
    const elevRad = (TOP_DOWN_ELEVATION_DEG * Math.PI) / 180;
    const halfV = (camera.fov * Math.PI) / 180 / 2;
    const halfH = Math.atan(Math.tan(halfV) * camera.aspect);

    // Fit the target's bounding sphere. R encloses every span the target
    // can present to the camera regardless of azimuth — for a tall building
    // this prevents the camera landing inside the geometry when looking
    // nearly-overhead at the b.h/2 centroid.
    const R = 0.5 * Math.sqrt(fitW * fitW + fitD * fitD + fitH * fitH);
    const halfFov = Math.min(halfV, halfH);
    const dist = Math.max((R / Math.sin(halfFov)) * TOP_DOWN_PADDING_MULT, controls.minDistance);

    // Azimuth: preserve current horizontal direction from target → camera.
    // If the camera is too close to nadir, fall back to the root-street axis.
    const cur = _scratchDir.subVectors(camera.position, controls.target);
    cur.y = 0;
    let dirX = cur.x;
    let dirZ = cur.z;
    const horizLenSq = dirX * dirX + dirZ * dirZ;
    // 1e-4 = (1 cm)^2 in world units — if the camera's horizontal offset
    // from the target is sub-centimeter, treat it as nadir and fall back
    // to the root-street axis so the azimuth doesn't NaN out.
    if (horizLenSq < 1e-4) {
      const root = world.getRootStreet();
      if (root && root.orientation === StreetAxis.X) {
        dirX = -1;
        dirZ = 0;
      } else {
        dirX = 0;
        dirZ = -1;
      }
    } else {
      const inv = 1 / Math.sqrt(horizLenSq);
      dirX *= inv;
      dirZ *= inv;
    }

    const cosE = Math.cos(elevRad);
    const sinE = Math.sin(elevRad);
    const newCamPos = new THREE.Vector3(
      center.x + dirX * dist * cosE,
      center.y + dist * sinE,
      center.z + dirZ * dist * cosE
    );

    camera.up.set(0, 1, 0);
    _animateCamera(center.clone(), newCamPos, CAMERA_BASE_DURATION_MS * durationRatio);
  }

  function focusBuilding(_mesh: THREE.Object3D, b: Building): void {
    const center = new THREE.Vector3(b.x, b.h / 2, b.y);
    _focusTopDown(center, b.w, b.d, b.h, BUILDING_FOCUS_RATIO);
  }

  function focusStreet(s: Street, hitPoint: THREE.Vector3 | null): void {
    let tx = s.x;
    let tz = s.y;
    if (hitPoint) {
      if (s.orientation === StreetAxis.X) tx = hitPoint.x;
      else tz = hitPoint.z;
    }
    const center = new THREE.Vector3(tx, 0, tz);
    const fitW = s.orientation === StreetAxis.X ? s.length : s.width;
    const fitD = s.orientation === StreetAxis.X ? s.width : s.length;
    _focusTopDown(center, fitW, fitD, 0, STREET_FOCUS_RATIO);
  }

  function focusTree(sha: string): void {
    const b = world.getTreeBoundsBySha(sha);
    if (!b) return;
    const center = new THREE.Vector3(b.x, b.height / 2, b.z);
    const span = b.radius * 2;
    _focusTopDown(center, span, span, b.height, BUILDING_FOCUS_RATIO);
  }

  /** Single entry-point for "focus the camera on whatever is selected".
   *  Dispatches to focusBuilding / focusStreet / focusTree based on the
   *  PickTarget kind. Lives on the scene side so view code doesn't have
   *  to know about the per-target focus mechanics. */
  function focusSelection(sel: PickTarget | null): void {
    if (!sel) return;
    if (sel.kind === NodeKind.File) focusBuilding(sel.mesh, sel.data);
    else if (sel.kind === NodeKind.Directory) focusStreet(sel.street, null);
    else if (sel.kind === NodeKind.Commit) focusTree(sel.commit.sha);
  }

  function dispose() {
    if (typeof controls.dispose === 'function') controls.dispose();
  }

  return {
    camera,
    controls,
    update,
    reset,
    recenterTo,
    focusBuilding,
    focusStreet,
    focusTree,
    focusSelection,
    dispose,
  };
}

export type CameraRig = ReturnType<typeof createCameraRig>;
