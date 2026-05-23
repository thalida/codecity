// scene/flyControls.ts — fly camera control with a visible cursor.
//
// Owns: keyboard + right-click-drag input, velocity integration, yaw/pitch
// rotation, and the fly-default reset pose. Disables/re-enables the
// shared OrbitControls (in cameraRig.ts) on enable/disable; both modes
// share the same THREE.PerspectiveCamera.
//
// Input model (matches Unity / Unreal / Godot / MSFS conventions):
//   - V toggles fly mode (persistent — stays on until toggled off).
//   - WASD/EQ move the camera; Shift boosts. Always-on while fly mode
//     is active, regardless of cursor position (text-input guard aside).
//   - Right-click + drag rotates the camera (mouse-look). Cursor stays
//     visible so the UI (sidebars, header, etc.) is interactive.
//   - Left-click and hover behave like orbit (cursor-driven).
//
// Public contract:
//   const fly = createFlyControls({ camera, canvas, rig, cityScene });
//   fly.enable()                    // listeners attached
//   fly.disable()                   // listeners detached; orbit target re-aimed
//   fly.update(dtMs)                // per-frame from animate loop
//   fly.isActive()                  // boolean
//   fly.resetToDefault()            // snap above+behind gem looking down the road
//   fly.onActiveChange(cb)          // subscribe to active-flag changes
//   fly.dispose()
//
// Reload behavior: not persisted. Reloads always land in orbit mode.
// See docs/superpowers/specs/2026-05-17-fly-mode-navigation-design.md.

import * as THREE from 'three';
import { TEXT_INPUT_TAGS } from '@/constants';
import { FLY_CONTROLS } from '@/config/index.js';
import { StreetAxis } from '@/types';
import type { WorldBounds } from './worldBounds.js';

export interface FlyControlsCityScene {
  getGemWorldPos: () => THREE.Vector3 | null;
  getRootStreet: () => { x: number; y: number; orientation: StreetAxis; isRoot?: boolean; width: number; length: number } | null;
  getBbox: () => THREE.Box3 | null;
  /** Current world floor bounds (rectangle the plane covers). Used to
   *  clamp fly-mode movement to the visible plane. Returns null when
   *  no city has been loaded yet — in that case fly mode runs
   *  unclamped. */
  getWorldBounds: () => WorldBounds | null;
}

// Only the `enabled` toggle is needed from OrbitControls. Using a
// structural interface keeps the type accurate while allowing lightweight
// test fakes without casting to `as never`.
export interface FlyControlsRig {
  controls: {
    enabled: boolean;
    /** OrbitControls.target — the pivot point. On fly exit we update
     *  this to a point in front of the camera so orbit doesn't snap
     *  the look direction to a stale pre-flight target. */
    target: THREE.Vector3;
  };
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
  // Look-engage flags, one per button. Either button-down engages
  // mouse-look; both up = idle. Tracking them independently keeps the
  // state correct when both are held and released in any order.
  // Convention: left OR right click + drag rotates the camera (the
  // short-click case is still routed to select by inputHandlers via the
  // movement threshold in its pointerup handler).
  let _lookLMB = false;
  let _lookRMB = false;

  function _isLooking(): boolean {
    return _lookLMB || _lookRMB;
  }

  // mousemove fires regardless of which buttons are held. We only
  // accumulate look delta while at least one button is engaged.
  // movementX/Y reports the delta from the previous mousemove event —
  // works fine without pointer lock.
  function _onMouseMove(e: MouseEvent) {
    if (!_isLooking()) return;
    mouseDeltaX += e.movementX || 0;
    mouseDeltaY += e.movementY || 0;
  }

  function _onMouseDown(e: MouseEvent) {
    if (e.button === 0) {
      _lookLMB = true;
    } else if (e.button === 2) {
      _lookRMB = true;
      // Suppress the browser context menu — right-click is the look
      // gesture in fly mode, not a menu trigger.
      e.preventDefault();
    } else {
      return;
    }
    canvas.style.cursor = 'grabbing';
  }

  function _onMouseUp(e: MouseEvent) {
    if (e.button === 0) _lookLMB = false;
    else if (e.button === 2) _lookRMB = false;
    else return;
    if (!_isLooking()) canvas.style.cursor = 'grab';
  }

  // Suppress the browser context menu while fly mode is active.
  function _onContextMenu(e: Event) {
    e.preventDefault();
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

  /** Clamp camera.position XZ to the world floor bounds. Returns true
   *  if the camera was repositioned (out of bounds before this call).
   *  No-op when world bounds aren't available (pre-layout / empty
   *  manifest). Y is untouched — only the plane footprint constrains
   *  movement; the user can still fly above the buildings. */
  function _clampToWorldBounds(): boolean {
    const wb = cityScene.getWorldBounds();
    if (!wb) return false;
    const minX = wb.cx - wb.halfWidth;
    const maxX = wb.cx + wb.halfWidth;
    const minZ = wb.cz - wb.halfDepth;
    const maxZ = wb.cz + wb.halfDepth;
    let moved = false;
    if (camera.position.x < minX) { camera.position.x = minX; moved = true; }
    else if (camera.position.x > maxX) { camera.position.x = maxX; moved = true; }
    if (camera.position.z < minZ) { camera.position.z = minZ; moved = true; }
    else if (camera.position.z > maxZ) { camera.position.z = maxZ; moved = true; }
    return moved;
  }

  function enable(): void {
    if (active) return;
    _baseSpeed = _computeBaseSpeed();
    _velocity.set(0, 0, 0);
    // Snap the camera to the nearest in-bounds point if the user
    // switched into fly mode from an orbit pose outside the plane —
    // otherwise they'd start out flying through empty void with no
    // floor reference. Y stays put; only XZ snap.
    if (_clampToWorldBounds()) {
      camera.updateMatrixWorld(true);
    }
    // Seed yaw/pitch from the current camera direction so entering fly
    // mode doesn't yank the view to a fixed orientation.
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    yaw = Math.atan2(-dir.x, -dir.z); // standard yaw with -Z = forward
    pitch = Math.asin(Math.max(-1, Math.min(1, dir.y)));
    mouseDeltaX = 0;
    mouseDeltaY = 0;
    _lookLMB = false;
    _lookRMB = false;
    document.addEventListener('keydown', _onKeyDown);
    document.addEventListener('keyup', _onKeyUp);
    canvas.addEventListener('mousemove', _onMouseMove);
    canvas.addEventListener('mousedown', _onMouseDown);
    // mouseup listens on document so a drag that leaves the canvas still
    // ends cleanly on release.
    document.addEventListener('mouseup', _onMouseUp);
    canvas.addEventListener('contextmenu', _onContextMenu);
    _setActive(true);
  }

  function disable(): void {
    if (!active) return;
    document.removeEventListener('keydown', _onKeyDown);
    document.removeEventListener('keyup', _onKeyUp);
    canvas.removeEventListener('mousemove', _onMouseMove);
    canvas.removeEventListener('mousedown', _onMouseDown);
    document.removeEventListener('mouseup', _onMouseUp);
    canvas.removeEventListener('contextmenu', _onContextMenu);
    _resetKeyState();
    _velocity.set(0, 0, 0);
    mouseDeltaX = 0;
    mouseDeltaY = 0;
    _lookLMB = false;
    _lookRMB = false;

    // Hand off to orbit. Fly mode keeps the camera over the visible
    // plane (XZ is clamped to world bounds in update()), so the
    // natural orbit pivot is the point on the floor DIRECTLY BELOW
    // the camera — independent of which direction the user was
    // looking. OrbitControls' lookAt(target) will then rotate the
    // view straight down to face that point, giving a clean
    // "switched to top-down orbit over my current spot" feel.
    rig.controls.target.set(camera.position.x, 0, camera.position.z);

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
    // idle, leave the quaternion alone — both so external camera tweens
    // can rotate the camera without fly mode fighting them, and to avoid
    // per-frame yaw/pitch re-seeding from a stale camera direction that
    // produced visible jitter / "can't look around" behavior.
    //
    // Code that wants to set fly mode's orientation (e.g. resetToDefault,
    // or a future focus tween) should write yaw/pitch directly via the
    // module's seeding logic.
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
    }

    // Movement — reads the newly-rotated camera direction.
    camera.getWorldDirection(_forward);
    _right.crossVectors(_forward, _worldUp).normalize();
    if (_right.lengthSq() < 1e-8) {
      _right.set(1, 0, 0);
    }

    // Recompute base speed each frame so live-updates that change the
    // world bbox (e.g. node_modules toggled on) immediately adjust fly speed.
    _baseSpeed = _computeBaseSpeed();
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

    // Constrain X/Z to the world floor's footprint. Zero the velocity
    // component that was pushing the camera past the edge so the user
    // doesn't keep "leaning" into the wall after release.
    const wb = cityScene.getWorldBounds();
    if (wb) {
      const minX = wb.cx - wb.halfWidth;
      const maxX = wb.cx + wb.halfWidth;
      const minZ = wb.cz - wb.halfDepth;
      const maxZ = wb.cz + wb.halfDepth;
      if (camera.position.x < minX) {
        camera.position.x = minX;
        if (_velocity.x < 0) _velocity.x = 0;
      } else if (camera.position.x > maxX) {
        camera.position.x = maxX;
        if (_velocity.x > 0) _velocity.x = 0;
      }
      if (camera.position.z < minZ) {
        camera.position.z = minZ;
        if (_velocity.z < 0) _velocity.z = 0;
      } else if (camera.position.z > maxZ) {
        camera.position.z = maxZ;
        if (_velocity.z > 0) _velocity.z = 0;
      }
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

      // Camera sits well ABOVE and BEHIND the gem (opposite the outward
      // axis), looking at the far end of the road. The altitude is
      // computed RELATIVE TO the gem's own hover height (gem.y) — the
      // gem floats some distance above the street, so a fixed camera
      // altitude can land below the gem on repos with tall hover
      // values. aboveGem scales with the city's building height.
      //
      // back-offset is sized so the gem appears at roughly 22° below
      // the look line — comfortably in the lower portion of the frame
      // but with enough sky above to see the road's perspective.
      const maxBldgH = bbox ? Math.max(1, bbox.max.y) : 10;
      const aboveGem = Math.max(40, maxBldgH * cfg.FLY_DEFAULT_ALTITUDE_FRAC);
      const altitude = gem.y + aboveGem;
      const backOffset = aboveGem * 2.5;

      camPos = new THREE.Vector3(
        gem.x - outward.x * backOffset,
        altitude,
        gem.z - outward.z * backOffset
      );
      // Look at the far end of the root road at ground level.
      target = new THREE.Vector3(
        gem.x + outward.x * root.length,
        0,
        gem.z + outward.z * root.length
      );
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
    // Compute yaw/pitch directly from the target direction, then write
    // the quaternion via setFromEuler — the SAME path the per-frame
    // mouse-look uses. Going through camera.lookAt() and reading back
    // via getWorldDirection() produces a quaternion that isn't bit-
    // identical to a fresh setFromEuler reconstruction, which left the
    // first post-R frame in a slightly different state from every
    // subsequent frame and (on some browsers/canvas sizes) produced a
    // blank frame until the user moved the mouse and update() rewrote
    // the quaternion.
    const dir = target.clone().sub(camPos);
    const horiz = Math.hypot(dir.x, dir.z);
    yaw = Math.atan2(-dir.x, -dir.z);
    pitch = Math.atan2(dir.y, horiz);
    const pitchLimit = (cfg.PITCH_CLAMP_DEG * Math.PI) / 180;
    if (pitch > pitchLimit) pitch = pitchLimit;
    if (pitch < -pitchLimit) pitch = -pitchLimit;
    const euler = new THREE.Euler(pitch, yaw, 0, 'YXZ');
    camera.quaternion.setFromEuler(euler);
    // Force matrix re-derivation so the next render sees the new pose
    // even if no other system writes the camera between now and then.
    camera.updateMatrixWorld(true);
    // Clear any pending mouse deltas so they don't apply on top of the
    // freshly-reset orientation in the next update() frame.
    mouseDeltaX = 0;
    mouseDeltaY = 0;
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
    /** True while the user is holding left or right mouse to look around.
     *  Consumers use this to suppress hover/tooltip updates and other
     *  cursor-driven UI during a look-drag. */
    isLooking: _isLooking,
    update,
    resetToDefault,
    syncFromCamera,
    onActiveChange,
    dispose,
    /** Internal — exposed for unit tests; not part of the public API. */
    _keyStateForTest: () => ({ ...keyState }),
  };
}
