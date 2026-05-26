// scene/cameraRig.ts — owns the perspective camera, OrbitControls,
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
  CAMERA_PERSPECTIVE,
  CAMERA_CONTROLS,
  CAMERA_ANIMATION,
  ANIMATION_TIMING,
} from '@/config/index.js';
import { CURRENT_SOURCE_KEY } from '@/store/sourceContext.js';
import { BuildingOrient, StreetAxis } from '@/types';
import type { Building, Street } from '@/types';
import type { createWorld } from '../world.js';

const SIGHTLINE_STEP_DEG = 20;
const SIGHTLINE_MAX_ATTEMPTS = 5;
const SIGHTLINE_FAR_OFFSET = 0.5;

/** Floor on controls.maxDistance regardless of city size. Tiny-but-tall
 *  cities (small footprint, one big building) end up with a tiny
 *  worldRadius if Y is the only large axis — and on cities with little
 *  geometry at all, worldRadius is near zero. This guarantees the user
 *  can always pull back to a comfortable cinematic viewing distance. */
const MIN_MAX_DISTANCE = 8000;

// Per-action duration ratios relative to ANIMATION_TIMING.BASE_DURATION_MS.
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

export function createCameraRig({
  canvas,
  world,
}: {
  canvas: HTMLCanvasElement;
  world: ReturnType<typeof createWorld>;
}) {
  const perspective = CAMERA_PERSPECTIVE.get();
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;
  const camera = new THREE.PerspectiveCamera(
    perspective.FOV,
    W / Math.max(1, H),
    perspective.NEAR,
    perspective.FAR
  );

  const cameraControlsCfg = CAMERA_CONTROLS.get();
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = cameraControlsCfg.DAMPING_FACTOR;
  controls.screenSpacePanning = false;
  controls.zoomToCursor = true;
  controls.maxPolarAngle = Math.PI * cameraControlsCfg.MAX_POLAR_ANGLE_FRAC;
  controls.minDistance = cameraControlsCfg.MIN_DISTANCE;
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

  // Reusable scratch for sight-line raycasting.
  const _xrayRay = new THREE.Raycaster();
  const _xrayDir = new THREE.Vector3();

  // Compute the canonical "framed" pose for the current world bbox and
  // refresh initialCamPos/initialTarget + controls.maxDistance + the
  // OrbitControls saveState snapshot. Does NOT move the user's camera.
  // Called on first frame and after every manifest swap so reset() always
  // snaps to a pose that fits the current city — without this, toggling
  // SHOW_ALL_FILES off after zooming way out left R targeting the OLD
  // (large-city) framing while the camera was far outside the new bbox.
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
    controls.maxDistance = Math.max(
      worldRadius * cameraControlsCfg.MAX_DISTANCE_MULT,
      MIN_MAX_DISTANCE
    );

    // Far clip: covers the farthest point a fully-zoomed-out camera can
    // see (maxDistance past target, plus the world's own radius). Set
    // unconditionally so it shrinks for small worlds (depth-buffer
    // precision matters for the hover-ghost inset) AND grows for huge
    // worlds. Floored at the Cyberpunk Valley sky-sphere's outer extent
    // (CAMERA_PERSPECTIVE.FAR × 0.95) so the sphere never gets clipped
    // at the corners of small-repo viewports.
    const dynamicFar = controls.maxDistance * 2 + worldRadius * 2;
    const skySphereExtent = CAMERA_PERSPECTIVE.get().FAR * 0.95;
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
      // so width × 10 reliably fits the gem + the road's first stretch
      // regardless of project size.
      framingRadius = rootStreet.width * 15;
    } else {
      // No gem (empty manifest, pre-build) — fall back to whole-world.
      framingCenter = worldGroundCenter;
      framingRadius = worldRadius;
    }
    const framingDist =
      (framingRadius / Math.sin(halfFov)) * cameraControlsCfg.INITIAL_DISTANCE_MULT;

    // Default framing: place the camera BEHIND the gem along the root
    // street's long axis (the street extends in +X for X-oriented or +Z
    // for Y-oriented; the gem sits at the low end — see
    // engine.ts:createRootGem) at a low cinematic elevation. This gives
    // a "looking down the main road into the city" view instead of the
    // previous top-down (-1, 1, 1) oblique. y=0.25 → ~14° elevation;
    // wide enough to see the whole skyline, low enough that the
    // horizon-glow band is visible above the buildings. Fallback
    // (no gem) keeps the old high-oblique direction for completeness.
    let dir: THREE.Vector3;
    if (rootStreet) {
      dir =
        rootStreet.orientation === StreetAxis.X
          ? new THREE.Vector3(-1, 0.25, 0).normalize()
          : new THREE.Vector3(0, 0.25, -1).normalize();
    } else {
      dir = new THREE.Vector3(-1, 1, 1).normalize();
    }
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

    // Re-frame on every manifest swap so R always fits the current city.
    if (!_rebuildSubscribed) {
      world.onChange(() => {
        _captureFraming();
      });
      // Reset to bbox framing when the user switches source mid-session.
      let _lastSourceKey = CURRENT_SOURCE_KEY.get();
      CURRENT_SOURCE_KEY.subscribe((newKey) => {
        if (newKey === null || newKey === _lastSourceKey) return;
        _lastSourceKey = newKey;
        controls.reset();
      });
      _rebuildSubscribed = true;
    }
    return true;
  }

  function update(_dtMs: number): void {
    if (firstFrame) {
      if (_frameToBbox()) firstFrame = false;
    }
    // When disabled (fly mode), skip the per-frame update entirely.
    // OrbitControls.update() unconditionally calls camera.lookAt(target)
    // regardless of the `enabled` flag — in fly mode that fights
    // flyControls' yaw/pitch by pulling the camera toward the stale
    // orbit target every frame.
    if (!controls.enabled) return;
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
    const easingPower = ANIMATION_TIMING.get().EASING_POWER;

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
    // the user was (e.g. R after toggling SHOW_ALL_FILES on, going from a
    // close-up small world to a far-out big world). Disabling damping
    // during the snap consumes those deltas in one frame at full strength,
    // then we re-enable damping for normal use.
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
      ANIMATION_TIMING.get().BASE_DURATION_MS * RECENTER_RATIO
    );
  }

  function _isSightClear(camPos: THREE.Vector3, target: THREE.Vector3, focused: Building): boolean {
    _xrayDir.subVectors(target, camPos).normalize();
    _xrayRay.set(camPos, _xrayDir);
    _xrayRay.far = camPos.distanceTo(target) - SIGHTLINE_FAR_OFFSET;
    // Raycast against every cell's detail InstancedMesh. Three.js
    // handles InstancedMesh natively: hits carry `.instanceId` (the
    // slot) and we identify the cell via `object.userData.cellId`.
    const hits = _xrayRay.intersectObjects(world.getBuildingPickables(), false);
    for (let i = 0; i < hits.length; i++) {
      const hit = hits[i];
      // Skip the focused building itself — its own faces always block its
      // own sightline. Match on (cellId, slotId).
      const hitCellId = hit.object.userData.cellId;
      if (hitCellId === focused.cellId && hit.instanceId === focused.slotId) continue;
      return false;
    }
    return true;
  }

  // Frame the building's door face head-on. Pivot is the building
  // centroid so subsequent orbit circles around the building. Tries
  // increasing elevations until the sightline is unobstructed.
  function focusBuilding(mesh: THREE.Object3D, b: Building): void {
    camera.up.set(0, 1, 0);
    const camAnim = CAMERA_ANIMATION.get();
    let doorDX = 0,
      doorDZ = 0,
      faceW: number;
    if (b.orient === BuildingOrient.South) {
      doorDZ = 1;
      faceW = b.w;
    } else if (b.orient === BuildingOrient.North) {
      doorDZ = -1;
      faceW = b.w;
    } else if (b.orient === BuildingOrient.East) {
      doorDX = 1;
      faceW = b.d;
    } else if (b.orient === BuildingOrient.West) {
      doorDX = -1;
      faceW = b.d;
    } else {
      doorDZ = 1;
      faceW = b.w;
    }
    const faceH = b.h;

    const halfV = (camera.fov * Math.PI) / 180 / 2;
    const halfH = Math.atan(Math.tan(halfV) * camera.aspect);
    const distForH = faceH / 2 / Math.tan(halfV);
    const distForW = faceW / 2 / Math.tan(halfH);
    const dist =
      Math.max(distForH, distForW) * camAnim.BUILDING_FOCUS_DISTANCE_MULT +
      camAnim.BUILDING_FOCUS_DISTANCE_OFFSET;

    const halfDepth =
      b.orient === BuildingOrient.East || b.orient === BuildingOrient.West ? b.w / 2 : b.d / 2;
    const newTarget = new THREE.Vector3(b.x, b.h / 2, b.y);

    let newCamPos: THREE.Vector3 | null = null;
    for (let attempt = 0; attempt < SIGHTLINE_MAX_ATTEMPTS; attempt++) {
      const elev = (attempt * SIGHTLINE_STEP_DEG * Math.PI) / 180;
      const horiz = dist * Math.cos(elev);
      const vert = b.h / 2 + dist * Math.sin(elev);
      const candidate = new THREE.Vector3(
        b.x + doorDX * (halfDepth + horiz),
        vert,
        b.y + doorDZ * (halfDepth + horiz)
      );
      if (_isSightClear(candidate, newTarget, b)) {
        newCamPos = candidate;
        break;
      }
      newCamPos = candidate;
    }

    if (newCamPos) {
      _animateCamera(
        newTarget,
        newCamPos,
        ANIMATION_TIMING.get().BASE_DURATION_MS * BUILDING_FOCUS_RATIO
      );
    }
  }

  // Orient camera so the street runs left-right across the screen and
  // zoom in to a navigable distance. See main.js's original block for
  // the full geometric reasoning — kept verbatim here.
  function focusStreet(s: Street, hitPoint: THREE.Vector3 | null): void {
    let tx = s.x,
      tz = s.y;
    if (hitPoint) {
      if (s.orientation === StreetAxis.X) tx = hitPoint.x;
      else tz = hitPoint.z;
    }
    const newTarget = new THREE.Vector3(tx, 0, tz);

    let offX = 0,
      offZ = 0;
    if (s.orientation === StreetAxis.X) {
      offZ = 1;
    } else {
      offX = 1;
    }
    camera.up.set(0, 1, 0);

    // Camera altitude clears every building. (The previous version also
    // multiplied each building's height by its mesh.scale.y to factor in
    // entry/exit tweens — that doesn't apply in cell mode because the
    // scale.y tween rides on the per-instance matrix inside the cell's
    // InstancedMesh, not on a per-building scene-graph mesh. A tween-
    // expanded building can briefly poke above this baseline; in practice
    // the tweens settle within ~200ms, well before the street-focus
    // camera animation completes.)
    const maxBldgH = world.getMaxBuildingHeight();

    const camAnim = CAMERA_ANIMATION.get();
    const halfV = (camera.fov * Math.PI) / 180 / 2;
    const halfH = Math.atan(Math.tan(halfV) * camera.aspect);
    const distForLength = (s.length * camAnim.STREET_FOCUS_LENGTH_FRAC) / 2 / Math.tan(halfH);
    const distForWidth = (s.width * camAnim.STREET_FOCUS_WIDTH_MULT) / 2 / Math.tan(halfV);
    const altitude = Math.max(
      distForLength,
      distForWidth,
      maxBldgH * camAnim.STREET_FOCUS_ALTITUDE_BLDG_MULT + camAnim.STREET_FOCUS_ALTITUDE_FLOOR
    );

    const elev = (camAnim.STREET_FOCUS_ELEVATION_DEG * Math.PI) / 180;
    const horizDist = altitude / Math.tan(elev);

    const newCamPos = new THREE.Vector3(tx + offX * horizDist, altitude, tz + offZ * horizDist);
    _animateCamera(
      newTarget,
      newCamPos,
      ANIMATION_TIMING.get().BASE_DURATION_MS * STREET_FOCUS_RATIO
    );
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
    dispose,
  };
}
