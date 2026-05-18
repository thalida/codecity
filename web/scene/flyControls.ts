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

  // cityScene is unused in this skeleton — Tasks 5 and 8 wire it into
  // velocity integration and resetToDefault. Reference it here so
  // editors/linters don't flag the destructure as dead code.
  void cityScene;

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
    document.addEventListener('keydown', _onKeyDown);
    document.addEventListener('keyup', _onKeyUp);
    _setActive(true);
  }

  function disable(): void {
    if (!active) return;
    document.removeEventListener('keydown', _onKeyDown);
    document.removeEventListener('keyup', _onKeyUp);
    _resetKeyState();
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

  function update(_dtMs: number): void {
    // Task 5 fills this in.
    if (!active) return;
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

  // camera is unused in this skeleton — Tasks 4/5 use it for rotation
  // and movement. Reference here to prevent dead-code warnings.
  void camera;

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
