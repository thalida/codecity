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

export interface FlyControlsCityScene {
  getGemWorldPos: () => THREE.Vector3 | null;
  getRootStreet: () => { x: number; y: number; orientation: 'X' | 'Y'; isRoot?: boolean; width: number; length: number } | null;
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
    _setActive(true);
  }

  function disable(): void {
    if (!active) return;
    document.removeEventListener('keydown', _onKeyDown);
    document.removeEventListener('keyup', _onKeyUp);
    canvas.removeEventListener('mousemove', _onMouseMove);
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
    if (mouseDeltaX !== 0 || mouseDeltaY !== 0) {
      yaw -= mouseDeltaX * cfg.MOUSE_SENSITIVITY;
      pitch -= mouseDeltaY * cfg.MOUSE_SENSITIVITY;
      const pitchLimit = (cfg.PITCH_CLAMP_DEG * Math.PI) / 180;
      if (pitch > pitchLimit) pitch = pitchLimit;
      if (pitch < -pitchLimit) pitch = -pitchLimit;
      mouseDeltaX = 0;
      mouseDeltaY = 0;
    }

    // Compose camera quaternion from yaw (Y-axis) then pitch (X-axis).
    // YXZ order keeps roll at zero — no banking.
    const euler = new THREE.Euler(pitch, yaw, 0, 'YXZ');
    camera.quaternion.setFromEuler(euler);
    camera.up.set(0, 1, 0);

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
    // Task 8 fills this in.
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
    onActiveChange,
    dispose,
    /** Internal — exposed for unit tests; not part of the public API. */
    _keyStateForTest: () => ({ ...keyState }),
  };
}
