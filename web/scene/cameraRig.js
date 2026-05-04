// scene/cameraRig.js — owns the perspective camera, OrbitControls,
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
import {
  CAMERA_PERSPECTIVE,
  CAMERA_CONTROLS,
  CAMERA_ANIMATION
} from '../config/index.js';
import { BUILDING_ORIENT } from '../constants.js';

// _focusBuilding tries head-on, then tilts up if the view is obstructed.
var SIGHTLINE_STEP_DEG     = 20;
var SIGHTLINE_MAX_ATTEMPTS = 5;
var SIGHTLINE_FAR_OFFSET   = 0.5;

var SAVED_CAMERA_KEY = 'cc.cameraPose';


export function createCameraRig({ canvas, cityScene }) {
  var perspective = CAMERA_PERSPECTIVE.get();
  var W = canvas.clientWidth;
  var H = canvas.clientHeight;
  var camera = new THREE.PerspectiveCamera(
    perspective.FOV,
    W / Math.max(1, H),
    perspective.NEAR,
    perspective.FAR
  );

  var cameraControlsCfg = CAMERA_CONTROLS.get();
  var controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = cameraControlsCfg.DAMPING_FACTOR;
  controls.screenSpacePanning = false;
  controls.zoomToCursor = true;
  controls.maxPolarAngle = Math.PI * cameraControlsCfg.MAX_POLAR_ANGLE_FRAC;
  controls.minDistance = cameraControlsCfg.MIN_DISTANCE;
  controls.mouseButtons = {
    LEFT:   THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT:  THREE.MOUSE.PAN
  };

  var firstFrame = true;
  var initialCamPos = null;
  var initialTarget = null;

  var _saveCameraTimer = 0;
  var _changeListenerAttached = false;

  function _saveCameraPose() {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(SAVED_CAMERA_KEY, JSON.stringify({
        pos:    { x: camera.position.x,  y: camera.position.y,  z: camera.position.z  },
        target: { x: controls.target.x,  y: controls.target.y,  z: controls.target.z  }
      }));
    } catch (_) { /* private mode / quota — ignore */ }
  }
  function _scheduleCameraSave() {
    if (_saveCameraTimer) clearTimeout(_saveCameraTimer);
    _saveCameraTimer = setTimeout(function () {
      _saveCameraTimer = 0;
      _saveCameraPose();
    }, 500);
  }

  // Animation cancellation token. Each new focus/reset animation bumps
  // this; in-flight rAF steps abort if their token doesn't match.
  var camAnimToken = 0;

  // Reusable scratch for sight-line raycasting.
  var _xrayRay = new THREE.Raycaster();
  var _xrayDir = new THREE.Vector3();

  function _frameToBbox() {
    var bbox = cityScene.getBbox();
    if (!bbox || bbox.isEmpty()) return false;

    var center = new THREE.Vector3();
    bbox.getCenter(center);
    var groundCenter = new THREE.Vector3(center.x, 0, center.z);

    // Camera distance: sized to the FARTHEST bbox corner relative to
    // the orbit pivot — guarantees every building fits even when the
    // pivot is offset from bbox center.
    var farX = Math.max(Math.abs(bbox.max.x - groundCenter.x), Math.abs(bbox.min.x - groundCenter.x));
    var farY = Math.max(Math.abs(bbox.max.y - groundCenter.y), Math.abs(bbox.min.y - groundCenter.y));
    var farZ = Math.max(Math.abs(bbox.max.z - groundCenter.z), Math.abs(bbox.min.z - groundCenter.z));
    var radius = Math.sqrt(farX * farX + farY * farY + farZ * farZ);
    var dist = radius / Math.sin((camera.fov * Math.PI / 180) / 2) * cameraControlsCfg.INITIAL_DISTANCE_MULT;

    var dir = new THREE.Vector3(-1, 1, 1).normalize();
    camera.position.copy(groundCenter).add(dir.multiplyScalar(dist));
    camera.lookAt(groundCenter);

    controls.target.copy(groundCenter);
    controls.maxDistance = dist * cameraControlsCfg.MAX_DISTANCE_MULT;

    // Snapshot AFTER defaults but BEFORE persistence restore — reset()
    // animates back to these so it must reflect the true fit.
    initialCamPos = camera.position.clone();
    initialTarget = controls.target.clone();

    // Restore saved pose if any. Done BEFORE attaching the change
    // listener so the restore itself doesn't trigger a re-save.
    try {
      if (typeof localStorage !== 'undefined') {
        var savedPoseRaw = localStorage.getItem(SAVED_CAMERA_KEY);
        if (savedPoseRaw) {
          var p = JSON.parse(savedPoseRaw);
          if (p && p.pos && p.target) {
            camera.position.set(p.pos.x, p.pos.y, p.pos.z);
            controls.target.set(p.target.x, p.target.y, p.target.z);
          }
        }
      }
    } catch (_) { /* corrupt JSON / unavailable storage — stay at default */ }

    if (!_changeListenerAttached) {
      controls.addEventListener('change', _scheduleCameraSave);
      _changeListenerAttached = true;
    }
    return true;
  }

  function update(_dtMs) {
    if (firstFrame) {
      if (_frameToBbox()) firstFrame = false;
    }
    controls.update();
  }

  function _animateCamera(newTarget, newCamPos, duration) {
    var token = ++camAnimToken;
    var startTarget = controls.target.clone();
    var startCamPos = camera.position.clone();
    var t0 = performance.now();
    var easingPower = CAMERA_ANIMATION.get().EASING_POWER;

    function step() {
      if (camAnimToken !== token) return;
      var elapsed = performance.now() - t0;
      var t = elapsed / duration;
      if (t >= 1) t = 1;
      var eased = 1 - Math.pow(1 - t, easingPower);
      controls.target.lerpVectors(startTarget, newTarget, eased);
      camera.position.lerpVectors(startCamPos, newCamPos, eased);
      if (t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function reset() {
    if (!initialCamPos || !initialTarget) return;
    if (_saveCameraTimer) { clearTimeout(_saveCameraTimer); _saveCameraTimer = 0; }
    try {
      if (typeof localStorage !== 'undefined') localStorage.removeItem(SAVED_CAMERA_KEY);
    } catch (_) { /* private mode / unavailable — ignore */ }
    camera.up.set(0, 1, 0);
    _animateCamera(
      initialTarget.clone(),
      initialCamPos.clone(),
      CAMERA_ANIMATION.get().RESET_DURATION_MS
    );
  }

  // Slide pivot to p; camera shifts by the same delta so the visible
  // scene doesn't zoom or rotate, just slides under.
  function recenterTo(p) {
    camera.up.set(0, 1, 0);
    var delta = p.clone().sub(controls.target);
    _animateCamera(
      p.clone(),
      camera.position.clone().add(delta),
      CAMERA_ANIMATION.get().RECENTER_DURATION_MS
    );
  }

  function _isSightClear(camPos, target, focusedMesh) {
    _xrayDir.subVectors(target, camPos).normalize();
    _xrayRay.set(camPos, _xrayDir);
    _xrayRay.far = camPos.distanceTo(target) - SIGHTLINE_FAR_OFFSET;
    var hits = _xrayRay.intersectObjects(cityScene.getBuildings(), false);
    for (var i = 0; i < hits.length; i++) {
      if (hits[i].object !== focusedMesh) return false;
    }
    return true;
  }

  // Frame the building's door face head-on. Pivot is the building
  // centroid so subsequent orbit circles around the building. Tries
  // increasing elevations until the sightline is unobstructed.
  function focusBuilding(mesh, b) {
    camera.up.set(0, 1, 0);
    var camAnim = CAMERA_ANIMATION.get();
    var doorDX = 0, doorDZ = 0, faceW;
    if      (b.orient === BUILDING_ORIENT.SOUTH) { doorDZ =  1; faceW = b.w; }
    else if (b.orient === BUILDING_ORIENT.NORTH) { doorDZ = -1; faceW = b.w; }
    else if (b.orient === BUILDING_ORIENT.EAST)  { doorDX =  1; faceW = b.d; }
    else if (b.orient === BUILDING_ORIENT.WEST)  { doorDX = -1; faceW = b.d; }
    else                                         { doorDZ =  1; faceW = b.w; }
    var faceH = b.h;

    var halfV = (camera.fov * Math.PI / 180) / 2;
    var halfH = Math.atan(Math.tan(halfV) * camera.aspect);
    var distForH = (faceH / 2) / Math.tan(halfV);
    var distForW = (faceW / 2) / Math.tan(halfH);
    var dist = Math.max(distForH, distForW) * camAnim.BUILDING_FOCUS_DISTANCE_MULT + camAnim.BUILDING_FOCUS_DISTANCE_OFFSET;

    var halfDepth = (b.orient === BUILDING_ORIENT.EAST || b.orient === BUILDING_ORIENT.WEST) ? b.w / 2 : b.d / 2;
    var newTarget = new THREE.Vector3(b.x, b.h / 2, b.y);

    var newCamPos = null;
    for (var attempt = 0; attempt < SIGHTLINE_MAX_ATTEMPTS; attempt++) {
      var elev = (attempt * SIGHTLINE_STEP_DEG) * Math.PI / 180;
      var horiz = dist * Math.cos(elev);
      var vert  = b.h / 2 + dist * Math.sin(elev);
      var candidate = new THREE.Vector3(
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

    _animateCamera(newTarget, newCamPos, camAnim.BUILDING_FOCUS_DURATION_MS);
  }

  // Orient camera so the street runs left-right across the screen and
  // zoom in to a navigable distance. See main.js's original block for
  // the full geometric reasoning — kept verbatim here.
  function focusStreet(s, hitPoint) {
    var tx = s.x, tz = s.y;
    if (hitPoint) {
      if (s.orientation === 'x') tx = hitPoint.x;
      else                       tz = hitPoint.z;
    }
    var newTarget = new THREE.Vector3(tx, 0, tz);

    var offX = 0, offZ = 0;
    if (s.orientation === 'x') {
      offZ = 1;
    } else {
      offX = 1;
    }
    camera.up.set(0, 1, 0);

    // Camera altitude clears every building. Factor in any current
    // scale.y from in-progress entry/exit tweens.
    var maxBldgH = 0;
    var buildingMeshes = cityScene.getBuildings();
    for (var i = 0; i < buildingMeshes.length; i++) {
      var mb = buildingMeshes[i].userData.building;
      var sy = buildingMeshes[i].scale.y || 1;
      var bh = (mb && mb.h ? mb.h : 0) * sy;
      if (bh > maxBldgH) maxBldgH = bh;
    }

    var camAnim = CAMERA_ANIMATION.get();
    var halfV = (camera.fov * Math.PI / 180) / 2;
    var halfH = Math.atan(Math.tan(halfV) * camera.aspect);
    var distForLength = (s.length * camAnim.STREET_FOCUS_LENGTH_FRAC / 2) / Math.tan(halfH);
    var distForWidth  = (s.width  * camAnim.STREET_FOCUS_WIDTH_MULT  / 2) / Math.tan(halfV);
    var altitude = Math.max(distForLength, distForWidth,
                            maxBldgH * camAnim.STREET_FOCUS_ALTITUDE_BLDG_MULT + camAnim.STREET_FOCUS_ALTITUDE_FLOOR);

    var elev = camAnim.STREET_FOCUS_ELEVATION_DEG * Math.PI / 180;
    var horizDist = altitude / Math.tan(elev);

    var newCamPos = new THREE.Vector3(
      tx + offX * horizDist,
      altitude,
      tz + offZ * horizDist
    );
    _animateCamera(newTarget, newCamPos, camAnim.STREET_FOCUS_DURATION_MS);
  }

  function dispose() {
    if (_changeListenerAttached) {
      controls.removeEventListener('change', _scheduleCameraSave);
      _changeListenerAttached = false;
    }
    if (_saveCameraTimer) { clearTimeout(_saveCameraTimer); _saveCameraTimer = 0; }
    if (typeof controls.dispose === 'function') controls.dispose();
  }

  return {
    camera: camera,
    controls: controls,
    update: update,
    reset: reset,
    recenterTo: recenterTo,
    focusBuilding: focusBuilding,
    focusStreet: focusStreet,
    dispose: dispose
  };
}
