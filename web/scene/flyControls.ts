// scene/flyControls.ts — first-person fly camera control.
//
// Owns: keyboard + pointer-lock input, velocity integration, yaw/pitch
// rotation, and the fly-default reset pose. Disables/re-enables the
// shared OrbitControls (in cameraRig.ts) on enable/disable; both modes
// share the same THREE.PerspectiveCamera.
//
// Public contract:
//   const fly = createFlyControls({ camera, canvas, rig, cityScene });
//   fly.enable()                    // pointer-lock + listeners attached
//   fly.disable()                   // pointer-lock released, listeners detached
//   fly.update(dtMs)                // per-frame from animate loop
//   fly.isActive()                  // boolean
//   fly.resetToDefault()            // snap to behind-gem-looking-down-street
//   fly.onActiveChange(cb)          // subscribe to active-flag changes
//   fly.dispose()
//
// Reload behavior: not persisted. Reloads always land in orbit mode.
// See docs/superpowers/specs/2026-05-17-fly-mode-navigation-design.md.

import * as THREE from 'three';
import { TEXT_INPUT_TAGS } from '@/constants';
import { FLY_CONTROLS } from '@/config/index.js';
import { StreetAxis } from '@/types';

export interface FlyControlsCityScene {
  getGemWorldPos: () => THREE.Vector3 | null;
  getRootStreet: () => { x: number; y: number; orientation: StreetAxis; isRoot?: boolean; width: number; length: number } | null;
  getBbox: () => THREE.Box3 | null;
  getBuildings: () => THREE.Object3D[];
}

// Only the `enabled` toggle is needed from OrbitControls. Using a
// structural interface keeps the type accurate while allowing lightweight
// test fakes without casting to `as never`.
export interface FlyControlsRig {
  controls: { enabled: boolean };
}

export interface FlyControlsOpts {
  camera: THREE.PerspectiveCamera;
  canvas: HTMLCanvasElement;
  rig: FlyControlsRig;
  cityScene: FlyControlsCityScene;
}

export function createFlyControls(opts: FlyControlsOpts) {
  const { camera, canvas, rig, cityScene } = opts;

  let active = false;
  const activeChangeCbs: Array<(active: boolean) => void> = [];

  type KeyState = {
    forward: boolean;
    back: boolean;
    left: boolean;
    right: boolean;
    up: boolean;
    down: boolean;
    boost: boolean;
  };

  const keyState: KeyState = {
    forward: false,
    back: false,
    left: false,
    right: false,
    up: false,
    down: false,
    boost: false,
  };

  let yaw = 0;    // rotation around world-Y (radians)
  let pitch = 0;  // rotation around camera-local X (radians)
  let mouseDeltaX = 0;
  let mouseDeltaY = 0;

  // Pointer-lock mousemove handler. Pointer lock is acquired on canvas;
  // canvas.requestPointerLock() makes subsequent mousemove events fire
  // on canvas with movementX/Y populated. Attaching to canvas (vs document)
  // keeps the handler scoped to this widget.
  function _onMouseMove(e: MouseEvent) {
    // Accumulate deltas; update() consumes and zeroes them.
    mouseDeltaX += e.movementX || 0;
    mouseDeltaY += e.movementY || 0;
  }

  // Scratch vectors for per-frame math — allocated once, reused across frames.
  const _forward = new THREE.Vector3();
  const _right = new THREE.Vector3();
  const _desired = new THREE.Vector3();
  const _worldUp = new THREE.Vector3(0, 1, 0);
  const _velocity = new THREE.Vector3();
  const _zeroVec = new THREE.Vector3();

  // Auto-derived base speed, recomputed on enable() so the value reflects
  // the world's current size. Stored on the closure rather than the
  // config so per-instance state stays per-instance.
  let _baseSpeed = 0;

  function _computeBaseSpeed(): number {
    const cfg = FLY_CONTROLS.get();
    const bbox = cityScene.getBbox();
    if (!bbox || bbox.isEmpty()) {
      return cfg.BASE_SPEED_MIN;
    }
    const size = new THREE.Vector3();
    bbox.getSize(size);
    const radius = Math.max(size.x, size.y, size.z) / 2;
    const raw = radius * cfg.BASE_SPEED_BBOX_FRAC;
    return Math.max(cfg.BASE_SPEED_MIN, Math.min(cfg.BASE_SPEED_MAX, raw));
  }

  function _resetKeyState() {
    keyState.forward = false;
    keyState.back = false;
    keyState.left = false;
    keyState.right = false;
    keyState.up = false;
    keyState.down = false;
    keyState.boost = false;
  }

  // Map a KeyboardEvent.key value to a key-state field, or null to ignore.
  // Movement keys are case-insensitive (treat 'W' the same as 'w') because
  // CapsLock or held-Shift would otherwise change the value.
  function _keyToField(k: string): keyof KeyState | null {
    const lower = k.length === 1 ? k.toLowerCase() : k;
    switch (lower) {
      case 'w': return 'forward';
      case 's': return 'back';
      case 'a': return 'left';
      case 'd': return 'right';
      case 'e': return 'up';
      case 'q': return 'down';
      case 'Shift': return 'boost';
      default: return null;
    }
  }

  function _onKeyDown(e: KeyboardEvent) {
    const targetEl = e.target as (HTMLElement & { isContentEditable?: boolean }) | null;
    const tag = (targetEl && targetEl.tagName) || '';
    if (TEXT_INPUT_TAGS.includes(tag) || (targetEl && targetEl.isContentEditable)) return;
    const f = _keyToField(e.key);
    if (f) {
      keyState[f] = true;
      // Prevent default for keys that would otherwise scroll the page or
      // affect form focus. Movement keys won't normally have side effects,
      // but being conservative here is cheap.
      e.preventDefault();
    }
  }

  function _onKeyUp(e: KeyboardEvent) {
    const targetEl = e.target as (HTMLElement & { isContentEditable?: boolean }) | null;
    const tag = (targetEl && targetEl.tagName) || '';
    if (TEXT_INPUT_TAGS.includes(tag) || (targetEl && targetEl.isContentEditable)) return;
    const f = _keyToField(e.key);
    if (f) {
      keyState[f] = false;
      e.preventDefault();
    }
  }

  function _onPointerLockChange() {
    // If we're active but the document no longer owns the lock, the
    // browser revoked it (Esc, alt-tab, focus loss). Exit fly mode.
    if (active && document.pointerLockElement !== canvas) {
      disable();
    }
  }

  function _onPointerLockError() {
    // Browser refused the lock request asynchronously (Esc cooldown,
    // iframe sandbox, etc.). Revert to orbit mode.
    if (active) {
      console.warn('Fly mode: pointer lock denied.');
      disable();
    }
  }

  function _setActive(next: boolean): void {
    if (active === next) return;
    active = next;
    rig.controls.enabled = !next;
    for (const cb of activeChangeCbs) {
      try {
        cb(active);
      } catch (_) {
        /* swallow listener errors so one bad listener doesn't break others */
      }
    }
  }

  function enable(): void {
    if (active) return;
    try {
      canvas.requestPointerLock?.();
    } catch (_) {
      console.warn('Fly mode: pointer lock unavailable.');
      return;
    }
    _baseSpeed = _computeBaseSpeed();
    _velocity.set(0, 0, 0);
    // Seed yaw/pitch from the current camera direction so entering fly
    // mode doesn't yank the view to a fixed orientation.
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    yaw = Math.atan2(-dir.x, -dir.z); // standard yaw with -Z = forward
    pitch = Math.asin(Math.max(-1, Math.min(1, dir.y)));
    mouseDeltaX = 0;
    mouseDeltaY = 0;
    document.addEventListener('keydown', _onKeyDown);
    document.addEventListener('keyup', _onKeyUp);
    canvas.addEventListener('mousemove', _onMouseMove);
    document.addEventListener('pointerlockchange', _onPointerLockChange);
    document.addEventListener('pointerlockerror', _onPointerLockError);
    _setActive(true);
  }

  function disable(): void {
    if (!active) return;
    document.removeEventListener('keydown', _onKeyDown);
    document.removeEventListener('keyup', _onKeyUp);
    canvas.removeEventListener('mousemove', _onMouseMove);
    document.removeEventListener('pointerlockchange', _onPointerLockChange);
    document.removeEventListener('pointerlockerror', _onPointerLockError);
    _resetKeyState();
    _velocity.set(0, 0, 0);
    mouseDeltaX = 0;
    mouseDeltaY = 0;
    try {
      document.exitPointerLock?.();
    } catch (_) {
      /* ignore */
    }
    _setActive(false);
  }

  function isActive(): boolean {
    return active;
  }

  function update(dtMs: number): void {
    if (!active) return;
    const cfg = FLY_CONTROLS.get();
    const dt = Math.max(0, dtMs) / 1000;

    // Mouse look — apply accumulated delta to yaw/pitch.
    let mouseDeltaConsumed = false;
    if (mouseDeltaX !== 0 || mouseDeltaY !== 0) {
      yaw -= mouseDeltaX * cfg.MOUSE_SENSITIVITY;
      pitch -= mouseDeltaY * cfg.MOUSE_SENSITIVITY;
      const pitchLimit = (cfg.PITCH_CLAMP_DEG * Math.PI) / 180;
      if (pitch > pitchLimit) pitch = pitchLimit;
      if (pitch < -pitchLimit) pitch = -pitchLimit;
      mouseDeltaX = 0;
      mouseDeltaY = 0;
      mouseDeltaConsumed = true;
    }

    // Compose camera quaternion only when the user is actively controlling
    // the camera (mouse moved this frame, or any movement key held). When
    // idle, leave the quaternion alone so external camera tweens (e.g.
    // rig.focusBuilding) can rotate the camera without fly mode fighting
    // them. The user's next input snaps yaw/pitch back to whatever the
    // tween left.
    const hasInput =
      mouseDeltaConsumed ||
      keyState.forward || keyState.back || keyState.left || keyState.right ||
      keyState.up || keyState.down;
    if (hasInput) {
      // Compose camera quaternion from yaw (Y-axis) then pitch (X-axis).
      // YXZ order keeps roll at zero — no banking.
      const euler = new THREE.Euler(pitch, yaw, 0, 'YXZ');
      camera.quaternion.setFromEuler(euler);
      camera.up.set(0, 1, 0);
    } else if (_velocity.equals(_zeroVec)) {
      // Fully idle (no input, no remaining velocity). Sync yaw/pitch from
      // whatever the camera currently shows so the next user input doesn't
      // snap back to a stale orientation.
      const dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      yaw = Math.atan2(-dir.x, -dir.z);
      pitch = Math.asin(Math.max(-1, Math.min(1, dir.y)));
    }
    // If velocity is non-zero but there is no input (coasting), leave the
    // quaternion untouched so the tween can continue uncontested.

    // Movement — reads the newly-rotated camera direction.
    camera.getWorldDirection(_forward);
    _right.crossVectors(_forward, _worldUp).normalize();
    if (_right.lengthSq() < 1e-8) {
      _right.set(1, 0, 0);
    }

    const speed = _baseSpeed * (keyState.boost ? cfg.BOOST_MULT : 1);
    _desired.set(0, 0, 0);
    if (keyState.forward) _desired.addScaledVector(_forward, speed);
    if (keyState.back) _desired.addScaledVector(_forward, -speed);
    if (keyState.right) _desired.addScaledVector(_right, speed);
    if (keyState.left) _desired.addScaledVector(_right, -speed);
    if (keyState.up) _desired.addScaledVector(_worldUp, speed);
    if (keyState.down) _desired.addScaledVector(_worldUp, -speed);

    const tauSec = Math.max(0.001, cfg.ACCEL_RAMP_MS / 1000);
    const alpha = 1 - Math.exp(-dt / tauSec);
    _velocity.lerp(_desired, alpha);

    camera.position.addScaledVector(_velocity, dt);
    if (camera.position.y < cfg.ALTITUDE_FLOOR) {
      camera.position.y = cfg.ALTITUDE_FLOOR;
      _velocity.y = Math.max(0, _velocity.y);
    }
  }

  function resetToDefault(): void {
    const cfg = FLY_CONTROLS.get();
    const gem = cityScene.getGemWorldPos();
    const root = cityScene.getRootStreet();
    const bbox = cityScene.getBbox();

    let target: THREE.Vector3;
    let camPos: THREE.Vector3;

    if (gem && root) {
      // Outward axis: the direction from the gem toward the bulk of the
      // street. For a stadium-shaped street with gem at the origin end,
      // the outward direction is whatever points from the gem toward the
      // street's center.
      const streetCenter = new THREE.Vector3(root.x, 0, root.y);
      const outward = streetCenter.clone().sub(gem).setY(0);
      if (outward.lengthSq() < 1e-6) {
        // Degenerate: gem and street center coincide. Pick orientation axis.
        outward.set(root.orientation === StreetAxis.X ? 1 : 0, 0, root.orientation === StreetAxis.X ? 0 : 1);
      }
      outward.normalize();

      // Tallest building approximation — use the bbox max Y as a stand-in
      // (FLY_DEFAULT_ALTITUDE_FRAC × tallest). Falls back to a sane min.
      const maxBldgH = bbox ? Math.max(1, bbox.max.y) : 10;
      const altitude = Math.max(maxBldgH * cfg.FLY_DEFAULT_ALTITUDE_FRAC, cfg.ALTITUDE_FLOOR);

      // Gem "radius" — use the street width as a stand-in (the gem scales
      // with street width via GEM_SIZING.RADIUS_AS_STREET_FRAC; using the
      // street width directly gives a comparable scale without taking a
      // hard dependency on that config).
      const gemRadius = root.width * 0.4;
      const offset = gemRadius * cfg.FLY_DEFAULT_GEM_OFFSET_MULT;

      camPos = gem.clone()
        .add(outward.clone().multiplyScalar(-offset))
        .setY(altitude);
      // Look at a point further along the outward direction (past the gem,
      // down the street).
      target = camPos.clone().add(outward.clone().multiplyScalar(offset + root.length));
    } else if (bbox && !bbox.isEmpty()) {
      // No gem — fall back to an elevated view of the bbox center.
      const center = new THREE.Vector3();
      bbox.getCenter(center);
      const size = new THREE.Vector3();
      bbox.getSize(size);
      const radius = Math.max(size.x, size.y, size.z) / 2;
      const altitude = Math.max(radius * 0.5, cfg.ALTITUDE_FLOOR);
      camPos = center.clone().add(new THREE.Vector3(-radius, 0, -radius)).setY(altitude);
      target = center.setY(0);
    } else {
      // No world at all — sane sentinel.
      camPos = new THREE.Vector3(0, Math.max(10, cfg.ALTITUDE_FLOOR), 20);
      target = new THREE.Vector3(0, 0, 0);
    }

    camera.position.copy(camPos);
    camera.up.set(0, 1, 0);
    camera.lookAt(target);
    // Re-seed yaw/pitch so subsequent mouse-look math reads the new orientation.
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    yaw = Math.atan2(-dir.x, -dir.z);
    pitch = Math.asin(Math.max(-1, Math.min(1, dir.y)));
    _velocity.set(0, 0, 0);
  }

  /**
   * Re-seed yaw/pitch from the camera's current orientation. Call this
   * after any external code (e.g. rig.focusBuilding's tween) has moved
   * the camera so subsequent fly-mode frames keep that orientation rather
   * than reverting to the pre-existing yaw/pitch.
   */
  function syncFromCamera(): void {
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    yaw = Math.atan2(-dir.x, -dir.z);
    pitch = Math.asin(Math.max(-1, Math.min(1, dir.y)));
  }

  function onActiveChange(cb: (active: boolean) => void): () => void {
    activeChangeCbs.push(cb);
    return () => {
      const i = activeChangeCbs.indexOf(cb);
      if (i >= 0) activeChangeCbs.splice(i, 1);
    };
  }

  function dispose(): void {
    if (active) disable();
    activeChangeCbs.length = 0;
  }

  return {
    enable,
    disable,
    isActive,
    update,
    resetToDefault,
    syncFromCamera,
    onActiveChange,
    dispose,
    /** Internal — exposed for unit tests; not part of the public API. */
    _keyStateForTest: () => ({ ...keyState }),
  };
}
