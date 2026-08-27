// city/render/cameraRig.ts — the perspective camera, OrbitControls, the opening
// pose, and the focus/reset animations. The rig knows what it is FOR: a project
// opens at the gem framing, a backdrop at its turntable, and reset() puts
// either back. The pose is never persisted; every load opens at its mode's.

import * as THREE from 'three';
import { computed, effect, untracked } from '@preact/signals';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  CAMERA_FOV,
  CAMERA_NEAR,
  CAMERA_FAR,
  CAMERA_DAMPING_FACTOR,
  CAMERA_MAX_POLAR_ANGLE_FRAC,
  CAMERA_MIN_DISTANCE,
  CAMERA_MAX_DISTANCE_MULT,
  CAMERA_GEM_FRAMING_WIDTH_MULT,
  CAMERA_INITIAL_DISTANCE_MULT,
  CAMERA_BASE_DURATION_MS,
  CAMERA_EASING_POWER,
} from '@/city/constants/camera';
import type { CityState } from '@/city/state';
import { computeFramingDir } from './framingDir';
import { gemRadiusFor } from '@/city/components/gem/mesh';
import { backdropRadius } from './backdropRadius';
import { Building } from '@/city/types/building';
import { NodeKind } from '@/city/types/manifest';
import { Street, StreetAxis } from '@/city/types/street';
import { PickTarget } from '@/city/types/picker';
import type { SettingSignals } from '@/city/settings/store';

/** How a focus command frames the node it looks at. */
export enum FocusMode {
  /** Swing overhead and pull in until the node fills the frame: what asking to
   *  focus something means. */
  Overhead = 'overhead',
  /** Slide the node under the crosshair, leaving elevation, azimuth and distance
   *  exactly where they were: what a selection the page opened with gets. */
  Recenter = 'recenter',
}

/** What the camera is FOR. The opening pose, what reset() returns to, and which
 *  settings section steers the camera all follow from this. */
export enum CameraMode {
  /** The opened project: framed on the root gem, off the user's Project view. */
  Project = 'project',
  /** Wallpaper behind the landing: a turntable circling the gem, off Home
   *  backdrop. Spins unless the user asked for less motion. */
  Backdrop = 'backdrop',
}

/** Where a mode's opening pose puts the camera, and what it looks at. */
interface CameraPlacement {
  target: THREE.Vector3;
  camPos: THREE.Vector3;
}

export interface CameraRigDeps {
  getRepoLabelBounds(): {
    centerX: number;
    centerY: number;
    centerZ: number;
    halfWidth: number;
    halfHeight: number;
  } | null;
  getTreeBoundsBySha(
    sha: string
  ): { x: number; y: number; z: number; height: number; radius: number } | null;
}

/** Floor on maxDistance: a tiny-but-tall city has a near-zero worldRadius, and
 *  the user still has to be able to pull back to a cinematic distance. */
const MIN_MAX_DISTANCE = 8000;

/** Shared by every snap, so nothing has to build its own (0, 1, 0). */
const WORLD_UP = new THREE.Vector3(0, 1, 0);

// Ratios of CAMERA_BASE_DURATION_MS, not absolutes: dragging the base in
// Settings then scales every animation while the relative pacing holds.
const BUILDING_FOCUS_RATIO = 1.2;
const STREET_FOCUS_RATIO = 1.2;

// Near-overhead, but off the pole: enough side-face for depth, and under
// controls.maxPolarAngle.
const TOP_DOWN_ELEVATION_DEG = 80;
const TOP_DOWN_PADDING_MULT = 2.8;

// 1.0 would sit the tallest spire flush against the top edge; the extra 5%
// of vertical FOV is the sky that keeps it off it.
const TALLEST_BUILDING_HEADROOM_MULT = 1.05;

/** A spinning turntable is exactly the motion this asks us to drop. */
function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/** Only a backdrop spins, and only when the caller hasn't asked for a still
 *  frame (the wallpaper capture) or the user for less motion. */
function _autoRotateFor(mode: CameraMode, wanted?: boolean): boolean {
  return mode === CameraMode.Backdrop && (wanted ?? !prefersReducedMotion());
}

export function createCameraRig({
  canvas,
  deps,
  cityState,
  settings,
  mode: initialMode = CameraMode.Project,
}: {
  canvas: HTMLCanvasElement;
  deps: CameraRigDeps;
  cityState: CityState;
  settings: SettingSignals;
  mode?: CameraMode;
}) {
  // The backdrop fields that PLACE the camera. Rotation speed is out: dragging
  // it mid-spin should change the speed, not yank the orbit back to its start
  // azimuth. Per rig, so a second city's backdrop pose is its own.
  const backdropPose = computed(() => {
    const s = settings.HOME_BACKDROP.value;
    return `${s.ELEVATION}|${s.AZIMUTH}|${s.DISTANCE}`;
  });

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

  let mode = initialMode;
  controls.autoRotate = _autoRotateFor(mode);
  // The opening pose lands on the first frame with a city to frame; after that
  // the camera is the user's (or the turntable's) until something resets it.
  let opened = false;
  let initialCamPos: THREE.Vector3 | null = null;
  let initialTarget: THREE.Vector3 | null = null;

  // Animation cancellation token. Each new focus/reset animation bumps
  // this; in-flight rAF steps abort if their token doesn't match.
  let camAnimToken = 0;

  // Refresh the framed pose without moving the user's camera. Re-run per
  // manifest swap, or R would still target the previous city's framing.
  function _captureFraming(): boolean {
    const bbox = cityState.bbox.value;
    if (!bbox || bbox.isEmpty()) return false;

    // Drive maxDistance + camera.far, so zooming all the way out shows the
    // whole city rather than clipping it at the far plane.
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

    // Off the world radius rather than worldDist/FOV: the latter is itself
    // small for a small city, which kept small cities cramped.
    controls.maxDistance = Math.max(worldRadius * CAMERA_MAX_DISTANCE_MULT, MIN_MAX_DISTANCE);

    // Shrinks for small worlds too (the hover-ghost inset needs the depth
    // precision), floored at the sky sphere so its corners never clip.
    const dynamicFar = controls.maxDistance * 2 + worldRadius * 2;
    const skySphereExtent = CAMERA_FAR * 0.95;
    camera.far = Math.max(dynamicFar, skySphereExtent);
    camera.updateProjectionMatrix();

    // Sized to the root street, not the world bbox: R should land on a
    // readable neighbourhood, not a metropolis with the gem as a dot.
    const gemPos = cityState.gemWorldPos.value;
    const rootStreet = cityState.rootStreet.value;
    let framingCenter: THREE.Vector3;
    let framingRadius: number;
    if (gemPos && rootStreet) {
      framingCenter = new THREE.Vector3(gemPos.x, 0, gemPos.z);
      // Width, not length: length tracks project size, so framing on it is
      // framing the whole world. Width is tier-bounded, so this holds.
      framingRadius = rootStreet.width * CAMERA_GEM_FRAMING_WIDTH_MULT;
    } else {
      // No gem (empty manifest, pre-build) — fall back to whole-world.
      framingCenter = worldGroundCenter;
      framingRadius = worldRadius;
    }
    // INITIAL_DISTANCE_MULT (<1) tightens the sphere fit on purpose, tuned
    // for the typical city shape.
    const widthDist = (framingRadius / Math.sin(halfFov)) * CAMERA_INITIAL_DISTANCE_MULT;
    // Behind the gem along the root street's axis (the gem sits at its low
    // end), lifted and swung by the user's angle. A CAMERA effect re-frames.
    const dir = computeFramingDir(
      settings.CAMERA.value.ELEVATION,
      settings.CAMERA.value.AZIMUTH,
      rootStreet ? rootStreet.orientation : null
    );

    // Smallest D fitting the tallest roof's 4 corners in the vertical FOV:
    // D ≥ |p · cam_up| / tan(halfFov) + p · dir, maxed over the corners.
    let heightDist = 0;
    const tallest = gemPos && rootStreet ? cityState.tallestBuilding.value : null;
    const labelBounds = gemPos && rootStreet ? deps.getRepoLabelBounds() : null;
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
      // At gem coords, not the building's own: p·dir would push the camera
      // back by the outlier's distance just to frame that one roof.
      if (tallest) {
        for (const sx of [-0.5, 0.5]) {
          for (const sz of [-0.5, 0.5]) {
            _fitPoint(gemX + sx * tallest.w, tallest.h, gemZ + sz * tallest.d);
          }
        }
      }
      // Height only: the panel is centred on the gem, already inside the
      // width fit, and its width settles on web-font load (issue #62).
      if (labelBounds) {
        const topY = labelBounds.centerY + labelBounds.halfHeight;
        _fitPoint(labelBounds.centerX, topY, labelBounds.centerZ);
      }
      heightDist *= TALLEST_BUILDING_HEADROOM_MULT;
    }
    const framingDist = Math.max(widthDist, heightDist);

    initialCamPos = framingCenter.clone().add(dir.multiplyScalar(framingDist));
    initialTarget = framingCenter.clone();

    // saveState reads the camera at call time, so stash/swap/restore is the
    // only way to reframe controls.reset() without moving the user.
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

  // bbox is reassigned only on a non-reuse apply, which is exactly when the
  // framing should update. Whether to SNAP is the composer's call, not this.
  const _disposeReframeEffect = effect(() => {
    void cityState.bbox.value;
    // Untracked: _captureFraming reads gem/rootStreet too, and the dependency
    // set should be exactly what this effect claims.
    untracked(_captureFraming);
  });

  // A saved angle re-frames the project it steers: reset() reads it and snaps.
  // On construction the bbox is empty, so this no-ops.
  const _disposeCameraAngleEffect = effect(() => {
    void settings.CAMERA.value;
    untracked(() => {
      if (mode === CameraMode.Project) reset();
    });
  });

  function update(_dtMs: number): void {
    if (!opened) reset();
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

  /** Put the camera where this city opens; false while there is nothing to frame
   *  yet. The only thing that places the opening pose, so it marks it placed. */
  function reset(): boolean {
    // Recapture every call: the final manifest is a reuse apply, so the bbox
    // effect never fires for it and a cached pose would be stale.
    if (!_captureFraming()) return false;
    const pose = mode === CameraMode.Backdrop ? _backdropPose() : _projectPose();
    if (!pose) return false;
    _snapTo(pose.target, pose.camPos, WORLD_UP);
    opened = true;
    return true;
  }

  /** Framed on the root gem at the user's Project view angle: what _captureFraming
   *  just worked out. */
  function _projectPose(): CameraPlacement | null {
    if (!initialCamPos || !initialTarget) return null;
    return { target: initialTarget.clone(), camPos: initialCamPos.clone() };
  }

  /** Hard-snap the camera onto a pose. Not controls.reset(): its trailing
   *  update() re-applies the user's residual deltas and drifts back off. */
  function _snapTo(target: THREE.Vector3, camPos: THREE.Vector3, up: THREE.Vector3): void {
    camAnimToken++; // or an in-flight focus keeps walking the camera off the pose
    // Both off across the update() below, which would otherwise feed residual
    // inertia into the pose and carry a spinning turntable past its azimuth.
    const wasDamping = controls.enableDamping;
    const wasAutoRotate = controls.autoRotate;
    controls.enableDamping = false;
    controls.autoRotate = false;
    camera.up.copy(up);
    camera.position.copy(camPos);
    controls.target.copy(target);
    camera.lookAt(target);
    controls.update();
    controls.enableDamping = wasDamping;
    controls.autoRotate = wasAutoRotate;
    // Refresh saveState so a later controls.reset() (a canceled focus tween)
    // snaps to the now-current pose.
    controls.saveState();
  }

  // Slide the pivot onto p; the camera shifts by the same delta, so the scene
  // slides under a camera that never turns or zooms.
  function _recenterOn(p: THREE.Vector3): void {
    // Recenter keeps the angle and distance it finds, so a URL restore (same
    // apply, before any frame) must find the opening pose, not the identity one.
    if (!opened) reset();
    const delta = p.clone().sub(controls.target);
    _snapTo(p.clone(), camera.position.clone().add(delta), WORLD_UP);
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

    // The bounding sphere encloses every span the target can present, so a
    // near-overhead look can't land the camera inside a tall building.
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
    // Sub-centimetre horizontal offset is nadir: the root-street axis stands
    // in, or the azimuth NaNs out.
    if (horizLenSq < 1e-4) {
      const root = cityState.rootStreet.value;
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

    camera.up.copy(WORLD_UP);
    _animateCamera(center.clone(), newCamPos, CAMERA_BASE_DURATION_MS * durationRatio);
  }

  /** Look at `center`, framed the way `mode` asks for. The fit extents and the
   *  duration are what Overhead reframes against; Recenter needs neither. */
  function _focus(
    center: THREE.Vector3,
    fitW: number,
    fitD: number,
    fitH: number,
    durationRatio: number,
    mode: FocusMode
  ): void {
    if (mode === FocusMode.Recenter) _recenterOn(center);
    else _focusTopDown(center, fitW, fitD, fitH, durationRatio);
  }

  function _focusBuilding(b: Building, mode: FocusMode): void {
    const center = new THREE.Vector3(b.x, b.h / 2, b.y);
    _focus(center, b.w, b.d, b.h, BUILDING_FOCUS_RATIO, mode);
  }

  function _focusStreet(s: Street, mode: FocusMode): void {
    const center = new THREE.Vector3(s.x, 0, s.y);
    const fitW = s.orientation === StreetAxis.X ? s.length : s.width;
    const fitD = s.orientation === StreetAxis.X ? s.width : s.length;
    _focus(center, fitW, fitD, 0, STREET_FOCUS_RATIO, mode);
  }

  function _focusTree(sha: string, mode: FocusMode): void {
    const b = deps.getTreeBoundsBySha(sha);
    if (!b) return;
    const center = new THREE.Vector3(b.x, b.height / 2, b.z);
    const span = b.radius * 2;
    _focus(center, span, span, b.height, BUILDING_FOCUS_RATIO, mode);
  }

  /** Capture only: an explicit pose, bypassing the top-down focus framing so a
   *  README shot can be low and street-level. Azimuth is off the root axis. */
  function captureView(opts: {
    target: THREE.Vector3;
    /** Explicit camera distance. If omitted, `fitRadius` is fit to the FOV. */
    distance?: number;
    /** Bounding-sphere radius to frame; used when `distance` is omitted. */
    fitRadius?: number;
    /** Extra breathing room around a fit (1 = flush to the FOV edges). */
    padding?: number;
    elevation: number;
    azimuth: number;
  }): void {
    camAnimToken++; // cancel any in-flight focus/reset tween
    let distance = opts.distance;
    if (distance == null && opts.fitRadius != null) {
      // Fit a sphere of fitRadius to the tighter of the horizontal/vertical FOV,
      // same math as _focusTopDown, using the live camera fov + aspect.
      const halfV = (camera.fov * Math.PI) / 180 / 2;
      const halfH = Math.atan(Math.tan(halfV) * camera.aspect);
      const halfFov = Math.min(halfV, halfH);
      distance = (opts.fitRadius / Math.sin(halfFov)) * (opts.padding ?? 1);
    }
    distance = Math.max(distance ?? controls.minDistance, controls.minDistance);
    const dir = computeFramingDir(
      opts.elevation,
      opts.azimuth,
      cityState.rootStreet.value?.orientation ?? null
    );
    camera.up.set(0, 1, 0);
    camera.position.copy(opts.target).addScaledVector(dir, distance);
    controls.target.copy(opts.target);
    camera.lookAt(opts.target);
    controls.update();
  }

  /** Debug/capture only: world anchor points + scales the shot poses frame
   *  against (see city/capture/shots.ts). */
  function captureAnchors(): {
    gem: THREE.Vector3 | null;
    tallestBuilding: THREE.Vector3 | null;
    center: THREE.Vector3 | null;
    tallestHeight: number;
    cityRadius: number;
    rootStreetWidth: number;
  } {
    const gem = cityState.gemWorldPos.value;
    const tb = cityState.tallestBuilding.value;
    const bbox = cityState.bbox.value;
    let center: THREE.Vector3 | null = null;
    let cityRadius = 0;
    if (bbox && !bbox.isEmpty()) {
      const c = bbox.getCenter(new THREE.Vector3());
      center = new THREE.Vector3(c.x, 0, c.z);
      cityRadius = bbox.getSize(new THREE.Vector3()).length() * 0.5;
    }
    return {
      gem: gem ? gem.clone() : null,
      tallestBuilding: tb ? new THREE.Vector3(tb.x, tb.h, tb.y) : null,
      center,
      tallestHeight: tb ? tb.h : 0,
      cityRadius,
      rootStreetWidth: cityState.rootStreet.value?.width ?? 0,
    };
  }

  /** Debug/capture only: world position + size of the tree for commit `sha`,
   *  or null if it isn't placed (for the fireflies close-up). */
  function treeAnchor(sha: string): { pos: THREE.Vector3; radius: number; height: number } | null {
    const b = deps.getTreeBoundsBySha(sha);
    if (!b) return null;
    return { pos: new THREE.Vector3(b.x, b.height * 0.5, b.z), radius: b.radius, height: b.height };
  }

  /** Debug/capture only: ground position + span of the street for directory
   *  `path`, or null if absent (for the streets shot). */
  function streetAnchor(
    path: string
  ): { pos: THREE.Vector3; width: number; length: number } | null {
    const s = cityState.streetsByDirMap.value[path];
    if (!s) return null;
    return { pos: new THREE.Vector3(s.x, 0, s.y), width: s.width, length: s.length };
  }

  /** Focus whatever is selected. On the scene side, so view code never has to
   *  know the per-target focus mechanics. */
  function focusSelection(sel: PickTarget | null, mode: FocusMode = FocusMode.Overhead): void {
    if (!sel) return;
    if (sel.kind === NodeKind.File) _focusBuilding(sel.data, mode);
    else if (sel.kind === NodeKind.Directory) _focusStreet(sel.street, mode);
    else if (sel.kind === NodeKind.Commit) _focusTree(sel.commit.sha, mode);
  }

  // ── Home backdrop ────────────────────────────────────────────────

  /** The distance the default camera rests at, which the backdrop counts in.
   *  Same inputs as _captureFraming's widthDist, so 1 lands where opening does. */
  function _gemFitDistance(): number | null {
    const rootStreet = cityState.rootStreet.value;
    if (!rootStreet) return null;
    const halfFov = (camera.fov * Math.PI) / 180 / 2;
    const framingRadius = rootStreet.width * CAMERA_GEM_FRAMING_WIDTH_MULT;
    return (framingRadius / Math.sin(halfFov)) * CAMERA_INITIAL_DISTANCE_MULT;
  }

  /** Where the backdrop orbit sits, in units of that framing distance. */
  function _backdropRadius(distance: number): number {
    const rootStreet = cityState.rootStreet.value;
    return backdropRadius(distance, controls, {
      gemRadius: rootStreet ? gemRadiusFor(rootStreet.width, settings.GEM_SIZING.value) : null,
      gemFitDistance: _gemFitDistance(),
      worldBounds: cityState.latestWorldBounds.value,
    });
  }

  /** A ground-level orbit circling the root gem, sized from the city's own
   *  geometry so every project is framed in proportion. */
  function _backdropPose(): CameraPlacement | null {
    const gem = cityState.gemWorldPos.value;
    if (!gem) return null;
    const backdrop = settings.HOME_BACKDROP.value;
    const dir = computeFramingDir(
      backdrop.ELEVATION,
      backdrop.AZIMUTH,
      cityState.rootStreet.value?.orientation ?? null
    );
    const target = gem.clone();
    return {
      target,
      camPos: target.clone().addScaledVector(dir, _backdropRadius(backdrop.DISTANCE)),
    };
  }

  /** Swap what the camera is for, opening on the new mode at once: the wallpaper
   *  capture drives a project rig into a still backdrop with no frame to wait. */
  function setMode(next: CameraMode, opts: { autoRotate?: boolean } = {}): void {
    mode = next;
    controls.autoRotate = _autoRotateFor(next, opts.autoRotate);
    reset();
  }

  // Saving a Home backdrop draft re-frames a running turntable in place, so the
  // wallpaper reflects the new pose without a reload.
  const _disposeBackdropPoseEffect = effect(() => {
    void backdropPose.value;
    untracked(() => {
      if (mode === CameraMode.Backdrop) reset();
    });
  });

  // Sole writer of autoRotateSpeed: runs on construction and on every change, so
  // no mode swap has to set it.
  const _disposeBackdropSpeedEffect = effect(() => {
    controls.autoRotateSpeed = settings.HOME_BACKDROP.value.ROTATE_SPEED;
  });

  function dispose() {
    _disposeReframeEffect();
    _disposeCameraAngleEffect();
    _disposeBackdropPoseEffect();
    _disposeBackdropSpeedEffect();
    if (typeof controls.dispose === 'function') controls.dispose();
  }

  return {
    camera,
    controls,
    update,
    reset,
    focusSelection,
    captureView,
    captureAnchors,
    treeAnchor,
    streetAnchor,
    setMode,
    dispose,
  };
}

export type CameraRig = ReturnType<typeof createCameraRig>;
