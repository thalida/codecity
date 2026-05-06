// scene/cameraRig.ts — owns the perspective camera, OrbitControls,
// camera-pose persistence, initial framing, and the focus/reset
// animations (R key reset, F key focus-on-selection, dblclick focus).
//
// Public contract:
//
//   const rig = createCameraRig({ canvas, cityScene });
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
// firstFrame flag is true and cityScene.getBbox() returns non-empty,
// then clears the flag. There's no surface for an accidental re-frame.
//
// Camera-pose persistence: every controls 'change' event debounces a
// localStorage save (cc.cameraPose). Restoration happens after the
// initial framing snapshot so reset() always animates back to the true
// default fit, not the user's last navigated pose.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CAMERA_PERSPECTIVE, CAMERA_CONTROLS, CAMERA_ANIMATION } from '@/config/index.js';
import { STORAGE_KEYS } from '@/constants';
import { BuildingOrient, StreetAxis } from '@/types';
import type { Building, Street } from '@/types';
import type { createCityScene } from './cityScene.js';

// _focusBuilding tries head-on, then tilts up if the view is obstructed.
const SIGHTLINE_STEP_DEG = 20;
const SIGHTLINE_MAX_ATTEMPTS = 5;
const SIGHTLINE_FAR_OFFSET = 0.5;

export function createCameraRig({
  canvas,
  cityScene,
}: {
  canvas: HTMLCanvasElement;
  cityScene: ReturnType<typeof createCityScene>;
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

  let _saveCameraTimer: ReturnType<typeof setTimeout> | 0 = 0;
  let _changeListenerAttached = false;

  function _saveCameraPose() {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(
        STORAGE_KEYS.CAMERA_POSE,
        JSON.stringify({
          pos: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
          target: { x: controls.target.x, y: controls.target.y, z: controls.target.z },
        })
      );
    } catch (_) {
      /* private mode / quota — ignore */
    }
  }
  function _scheduleCameraSave() {
    if (_saveCameraTimer) clearTimeout(_saveCameraTimer);
    _saveCameraTimer = setTimeout(() => {
      _saveCameraTimer = 0;
      _saveCameraPose();
    }, 500);
  }

  // Animation cancellation token. Each new focus/reset animation bumps
  // this; in-flight rAF steps abort if their token doesn't match.
  let camAnimToken = 0;

  // Reusable scratch for sight-line raycasting.
  const _xrayRay = new THREE.Raycaster();
  const _xrayDir = new THREE.Vector3();

  function _frameToBbox() {
    const bbox = cityScene.getBbox();
    if (!bbox || bbox.isEmpty()) return false;

    const center = new THREE.Vector3();
    bbox.getCenter(center);
    const groundCenter = new THREE.Vector3(center.x, 0, center.z);

    // Camera distance: sized to the FARTHEST bbox corner relative to
    // the orbit pivot — guarantees every building fits even when the
    // pivot is offset from bbox center.
    const farX = Math.max(
      Math.abs(bbox.max.x - groundCenter.x),
      Math.abs(bbox.min.x - groundCenter.x)
    );
    const farY = Math.max(
      Math.abs(bbox.max.y - groundCenter.y),
      Math.abs(bbox.min.y - groundCenter.y)
    );
    const farZ = Math.max(
      Math.abs(bbox.max.z - groundCenter.z),
      Math.abs(bbox.min.z - groundCenter.z)
    );
    const radius = Math.sqrt(farX * farX + farY * farY + farZ * farZ);
    const dist =
      (radius / Math.sin((camera.fov * Math.PI) / 180 / 2)) *
      cameraControlsCfg.INITIAL_DISTANCE_MULT;

    const dir = new THREE.Vector3(-1, 1, 1).normalize();
    camera.position.copy(groundCenter).add(dir.multiplyScalar(dist));
    camera.lookAt(groundCenter);

    controls.target.copy(groundCenter);
    controls.maxDistance = dist * cameraControlsCfg.MAX_DISTANCE_MULT;

    // Snapshot AFTER defaults but BEFORE persistence restore — reset()
    // snaps back to these so they must reflect the true fit.
    initialCamPos = camera.position.clone();
    initialTarget = controls.target.clone();
    // OrbitControls' own saved state used by controls.reset(). Captures
    // the framed camera pose AND clears any internal damping deltas
    // when reset() is called — without this the snap can drift on the
    // next frame because _sphericalDelta / _panOffset still carry
    // momentum from the user's last interaction.
    controls.saveState();

    // Restore saved pose if any. Done BEFORE attaching the change
    // listener so the restore itself doesn't trigger a re-save.
    try {
      if (typeof localStorage !== 'undefined') {
        const savedPoseRaw = localStorage.getItem(STORAGE_KEYS.CAMERA_POSE);
        if (savedPoseRaw) {
          const p = JSON.parse(savedPoseRaw);
          if (p?.pos && p?.target) {
            camera.position.set(p.pos.x, p.pos.y, p.pos.z);
            controls.target.set(p.target.x, p.target.y, p.target.z);
          }
        }
      }
    } catch (_) {
      /* corrupt JSON / unavailable storage — stay at default */
    }

    if (!_changeListenerAttached) {
      controls.addEventListener('change', _scheduleCameraSave);
      _changeListenerAttached = true;
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
    const easingPower = CAMERA_ANIMATION.get().EASING_POWER;

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
    if (!initialCamPos || !initialTarget) return;
    // Cancel any in-flight focus/reset animation so it can't keep
    // walking the camera away from the snap target.
    camAnimToken++;
    if (_saveCameraTimer) {
      clearTimeout(_saveCameraTimer);
      _saveCameraTimer = 0;
    }
    // Wipe persisted camera pose so a partially-applied reset doesn't
    // leave a stale pose to be restored on next page load.
    try {
      if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEYS.CAMERA_POSE);
    } catch (_) {
      /* private mode / unavailable — ignore */
    }
    camera.up.set(0, 1, 0);
    // Hard snap via controls.reset() instead of animating: animation +
    // OrbitControls damping let leftover momentum drift the camera past
    // the target and the change listener would then save the drifted
    // pose. controls.reset() restores the saveState pose AND clears the
    // internal _sphericalDelta / _panOffset / _scale deltas in one shot.
    controls.reset();
  }

  // Slide pivot to p; camera shifts by the same delta so the visible
  // scene doesn't zoom or rotate, just slides under.
  function recenterTo(p: THREE.Vector3): void {
    camera.up.set(0, 1, 0);
    const delta = p.clone().sub(controls.target);
    _animateCamera(
      p.clone(),
      camera.position.clone().add(delta),
      CAMERA_ANIMATION.get().RECENTER_DURATION_MS
    );
  }

  function _isSightClear(
    camPos: THREE.Vector3,
    target: THREE.Vector3,
    focusedMesh: THREE.Object3D
  ): boolean {
    _xrayDir.subVectors(target, camPos).normalize();
    _xrayRay.set(camPos, _xrayDir);
    _xrayRay.far = camPos.distanceTo(target) - SIGHTLINE_FAR_OFFSET;
    const hits = _xrayRay.intersectObjects(cityScene.getBuildings(), false);
    for (let i = 0; i < hits.length; i++) {
      if (hits[i].object !== focusedMesh) return false;
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
      if (_isSightClear(candidate, newTarget, mesh)) {
        newCamPos = candidate;
        break;
      }
      newCamPos = candidate;
    }

    if (newCamPos) {
      _animateCamera(newTarget, newCamPos, camAnim.BUILDING_FOCUS_DURATION_MS);
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

    // Camera altitude clears every building. Factor in any current
    // scale.y from in-progress entry/exit tweens.
    let maxBldgH = 0;
    const buildingMeshes = cityScene.getBuildings();
    for (let i = 0; i < buildingMeshes.length; i++) {
      const mb = buildingMeshes[i].userData.building;
      const sy = buildingMeshes[i].scale.y || 1;
      const bh = (mb && mb.h ? mb.h : 0) * sy;
      if (bh > maxBldgH) maxBldgH = bh;
    }

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
    _animateCamera(newTarget, newCamPos, camAnim.STREET_FOCUS_DURATION_MS);
  }

  function dispose() {
    if (_changeListenerAttached) {
      controls.removeEventListener('change', _scheduleCameraSave);
      _changeListenerAttached = false;
    }
    if (_saveCameraTimer) {
      clearTimeout(_saveCameraTimer);
      _saveCameraTimer = 0;
    }
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
