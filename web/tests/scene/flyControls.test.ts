import * as THREE from 'three';
import { describe, it, expect, vi } from 'vitest';
import { createFlyControls, type FlyControlsCityScene } from '@/scene/flyControls.js';
import { StreetAxis } from '@/types';

function makeFakeRig() {
  return {
    controls: { enabled: true } as { enabled: boolean },
  };
}

function makeFakeCityScene(): FlyControlsCityScene {
  return {
    getGemWorldPos: () => null,
    getRootStreet: () => null,
    getBbox: () => new THREE.Box3(new THREE.Vector3(-50, 0, -50), new THREE.Vector3(50, 10, 50)),
    getBuildings: () => [],
  };
}

function makeCanvas() {
  const canvas = document.createElement('canvas');
  // jsdom doesn't implement requestPointerLock — stub to no-op so
  // enable() doesn't throw. Tests don't assert lock acquisition.
  (canvas as unknown as { requestPointerLock: () => void }).requestPointerLock = vi.fn();
  return canvas;
}

describe('flyControls state machine', () => {
  it('starts inactive', () => {
    const camera = new THREE.PerspectiveCamera();
    const fly = createFlyControls({
      camera,
      canvas: makeCanvas(),
      rig: makeFakeRig(),
      cityScene: makeFakeCityScene(),
    });
    expect(fly.isActive()).toBe(false);
  });

  it('enable() flips active and disables orbit controls', () => {
    const camera = new THREE.PerspectiveCamera();
    const rig = makeFakeRig();
    const fly = createFlyControls({
      camera,
      canvas: makeCanvas(),
      rig,
      cityScene: makeFakeCityScene(),
    });
    fly.enable();
    expect(fly.isActive()).toBe(true);
    expect(rig.controls.enabled).toBe(false);
  });

  it('disable() flips inactive and re-enables orbit controls', () => {
    const camera = new THREE.PerspectiveCamera();
    const rig = makeFakeRig();
    const fly = createFlyControls({
      camera,
      canvas: makeCanvas(),
      rig,
      cityScene: makeFakeCityScene(),
    });
    fly.enable();
    fly.disable();
    expect(fly.isActive()).toBe(false);
    expect(rig.controls.enabled).toBe(true);
  });

  it('onActiveChange callback fires on enable and disable', () => {
    const camera = new THREE.PerspectiveCamera();
    const fly = createFlyControls({
      camera,
      canvas: makeCanvas(),
      rig: makeFakeRig(),
      cityScene: makeFakeCityScene(),
    });
    const cb = vi.fn();
    fly.onActiveChange(cb);
    fly.enable();
    fly.disable();
    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb).toHaveBeenNthCalledWith(1, true);
    expect(cb).toHaveBeenNthCalledWith(2, false);
  });
});

describe('flyControls dispose', () => {
  it('dispose() tears down active state and silences listeners', () => {
    const camera = new THREE.PerspectiveCamera();
    const fly = createFlyControls({
      camera,
      canvas: makeCanvas(),
      rig: makeFakeRig(),
      cityScene: makeFakeCityScene(),
    });
    const cb = vi.fn();
    fly.onActiveChange(cb);
    fly.enable();
    fly.dispose();
    expect(fly.isActive()).toBe(false);
    // After dispose, callbacks should have been cleared. Triggering enable
    // again should not call the disposed listener.
    cb.mockClear();
    fly.enable();
    expect(cb).not.toHaveBeenCalled();
  });
});

describe('flyControls key state', () => {
  it('tracks W/A/S/D + E/Q + Shift while active', () => {
    const camera = new THREE.PerspectiveCamera();
    const fly = createFlyControls({
      camera,
      canvas: makeCanvas(),
      rig: makeFakeRig(),
      cityScene: makeFakeCityScene(),
    });
    fly.enable();

    function fire(type: 'keydown' | 'keyup', key: string) {
      document.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true }));
    }

    fire('keydown', 'w');
    expect(fly._keyStateForTest().forward).toBe(true);

    fire('keydown', 'a');
    fire('keydown', 's');
    fire('keydown', 'd');
    fire('keydown', 'e');
    fire('keydown', 'q');
    fire('keydown', 'Shift');
    const ks = fly._keyStateForTest();
    expect(ks).toEqual({
      forward: true,
      back: true,
      left: true,
      right: true,
      up: true,
      down: true,
      boost: true,
    });

    fire('keyup', 'w');
    expect(fly._keyStateForTest().forward).toBe(false);

    fly.disable();
  });

  it('ignores keys when inactive', () => {
    const camera = new THREE.PerspectiveCamera();
    const fly = createFlyControls({
      camera,
      canvas: makeCanvas(),
      rig: makeFakeRig(),
      cityScene: makeFakeCityScene(),
    });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' }));
    expect(fly._keyStateForTest().forward).toBe(false);
  });

  it('clears key state on disable', () => {
    const camera = new THREE.PerspectiveCamera();
    const fly = createFlyControls({
      camera,
      canvas: makeCanvas(),
      rig: makeFakeRig(),
      cityScene: makeFakeCityScene(),
    });
    fly.enable();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' }));
    fly.disable();
    expect(fly._keyStateForTest().forward).toBe(false);
  });

  it('listeners are detached after disable (keydown after disable does not mutate state)', () => {
    const camera = new THREE.PerspectiveCamera();
    const fly = createFlyControls({
      camera,
      canvas: makeCanvas(),
      rig: makeFakeRig(),
      cityScene: makeFakeCityScene(),
    });
    fly.enable();
    fly.disable();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' }));
    expect(fly._keyStateForTest().forward).toBe(false);
  });

  it('ignores keys typed into text input elements', () => {
    const camera = new THREE.PerspectiveCamera();
    const fly = createFlyControls({
      camera,
      canvas: makeCanvas(),
      rig: makeFakeRig(),
      cityScene: makeFakeCityScene(),
    });
    fly.enable();

    const input = document.createElement('input');
    document.body.appendChild(input);
    try {
      input.focus();
      // KeyboardEvents need to be dispatched FROM the input element so that
      // e.target === input. Dispatching on document with the input focused
      // sets target to document, not the input, so we dispatch on the input.
      const ev = new KeyboardEvent('keydown', { key: 'w', bubbles: true });
      input.dispatchEvent(ev);
      expect(fly._keyStateForTest().forward).toBe(false);
    } finally {
      document.body.removeChild(input);
      fly.disable();
    }
  });
});

import { FLY_CONTROLS } from '@/config/index.js';

describe('flyControls velocity integration', () => {
  function setup() {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 10, 0);
    // Look toward -Z so "forward" is -Z in world space (three.js default).
    camera.lookAt(0, 10, -1);
    camera.updateMatrixWorld();
    const fly = createFlyControls({
      camera,
      canvas: makeCanvas(),
      rig: makeFakeRig(),
      cityScene: makeFakeCityScene(),
    });
    return { camera, fly };
  }

  it('W moves the camera forward (-Z)', () => {
    const { camera, fly } = setup();
    fly.enable();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' }));
    // Step long enough for the velocity ramp to finish (ACCEL_RAMP_MS = 100ms).
    for (let i = 0; i < 30; i++) fly.update(16);
    expect(camera.position.z).toBeLessThan(-1); // moved forward
    expect(camera.position.x).toBeCloseTo(0, 5); // didn't drift sideways
    fly.disable();
  });

  it('S moves the camera backward (+Z)', () => {
    const { camera, fly } = setup();
    fly.enable();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 's' }));
    for (let i = 0; i < 30; i++) fly.update(16);
    expect(camera.position.z).toBeGreaterThan(1);
    fly.disable();
  });

  it('A and D strafe left/right', () => {
    const { camera, fly } = setup();
    fly.enable();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'd' }));
    for (let i = 0; i < 30; i++) fly.update(16);
    expect(camera.position.x).toBeGreaterThan(1);
    fly.disable();
  });

  it('E moves up, Q moves down', () => {
    const { camera, fly } = setup();
    fly.enable();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'e' }));
    for (let i = 0; i < 30; i++) fly.update(16);
    expect(camera.position.y).toBeGreaterThan(10);
    fly.disable();
  });

  it('Shift boost multiplies speed (Shift+W moves further than W alone)', () => {
    const a = setup();
    a.fly.enable();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' }));
    for (let i = 0; i < 30; i++) a.fly.update(16);
    const dA = Math.abs(a.camera.position.z);
    a.fly.disable();

    const b = setup();
    b.fly.enable();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' }));
    for (let i = 0; i < 30; i++) b.fly.update(16);
    const dB = Math.abs(b.camera.position.z);
    b.fly.disable();

    expect(dB).toBeGreaterThan(dA * 2); // boost is 4× but allow 2× lower bound
  });

  it('altitude floor clamps y to ALTITUDE_FLOOR', () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 1, 0);
    // Look down so Q (down) moves into the ground.
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const fly = createFlyControls({
      camera,
      canvas: makeCanvas(),
      rig: makeFakeRig(),
      cityScene: makeFakeCityScene(),
    });
    fly.enable();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'q' }));
    for (let i = 0; i < 100; i++) fly.update(16);
    expect(camera.position.y).toBeGreaterThanOrEqual(FLY_CONTROLS.get().ALTITUDE_FLOOR);
    fly.disable();
  });

  it('does nothing when inactive', () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 10, 0);
    camera.updateMatrixWorld();
    const fly = createFlyControls({
      camera,
      canvas: makeCanvas(),
      rig: makeFakeRig(),
      cityScene: makeFakeCityScene(),
    });
    // Don't enable.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' }));
    fly.update(16);
    expect(camera.position.z).toBe(0);
  });
});

describe('flyControls mouse look', () => {
  it('mousemove rotates yaw and pitch on the next update()', () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 0, 0);
    camera.lookAt(0, 0, -1);
    camera.updateMatrixWorld();
    const canvas = makeCanvas();
    const fly = createFlyControls({
      camera,
      canvas,
      rig: makeFakeRig(),
      cityScene: makeFakeCityScene(),
    });
    fly.enable();
    // Yaw right: positive movementX with negative sensitivity sign convention.
    // Test by observing the camera.getWorldDirection() change.
    const before = new THREE.Vector3();
    camera.getWorldDirection(before);
    canvas.dispatchEvent(new MouseEvent('mousemove', { movementX: 100, movementY: 0 }));
    fly.update(16);
    const after = new THREE.Vector3();
    camera.getWorldDirection(after);
    // Yaw changed: the X component of forward should differ.
    expect(after.x).not.toBeCloseTo(before.x, 4);
    fly.disable();
  });

  it('pitch clamps to ±PITCH_CLAMP_DEG', () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 0, 0);
    camera.lookAt(0, 0, -1);
    camera.updateMatrixWorld();
    const canvas = makeCanvas();
    const fly = createFlyControls({
      camera,
      canvas,
      rig: makeFakeRig(),
      cityScene: makeFakeCityScene(),
    });
    fly.enable();
    // Pile up a huge upward mouse delta — pitch should clamp before reaching ±90°.
    for (let i = 0; i < 100; i++) {
      canvas.dispatchEvent(new MouseEvent('mousemove', { movementX: 0, movementY: -10000 }));
      fly.update(16);
    }
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    // At clamp pitch (85°), forward.y = sin(85°) ≈ 0.996. Allow some slack.
    expect(dir.y).toBeLessThan(0.999);
    expect(dir.y).toBeGreaterThan(0.99);
    fly.disable();
  });

  it('ignores mousemove when inactive', () => {
    const camera = new THREE.PerspectiveCamera();
    const before = new THREE.Quaternion().copy(camera.quaternion);
    const canvas = makeCanvas();
    createFlyControls({
      camera,
      canvas,
      rig: makeFakeRig(),
      cityScene: makeFakeCityScene(),
    });
    // Not enabled.
    canvas.dispatchEvent(new MouseEvent('mousemove', { movementX: 500, movementY: 500 }));
    expect(camera.quaternion.equals(before)).toBe(true);
  });
});

describe('flyControls pointer-lock error', () => {
  it('auto-disables when the browser fires pointerlockerror', () => {
    const camera = new THREE.PerspectiveCamera();
    const fly = createFlyControls({
      camera, canvas: makeCanvas(), rig: makeFakeRig(), cityScene: makeFakeCityScene(),
    });
    fly.enable();
    document.dispatchEvent(new Event('pointerlockerror'));
    expect(fly.isActive()).toBe(false);
  });
});

describe('flyControls pointer-lock revoke', () => {
  it('auto-disables when the browser revokes pointer lock', () => {
    const camera = new THREE.PerspectiveCamera();
    const canvas = makeCanvas();
    const fly = createFlyControls({
      camera,
      canvas,
      rig: makeFakeRig(),
      cityScene: makeFakeCityScene(),
    });
    fly.enable();
    expect(fly.isActive()).toBe(true);

    // Simulate browser revoking the lock: document.pointerLockElement
    // goes from canvas to null, then pointerlockchange fires.
    Object.defineProperty(document, 'pointerLockElement', {
      configurable: true,
      get: () => null,
    });
    document.dispatchEvent(new Event('pointerlockchange'));

    expect(fly.isActive()).toBe(false);
  });
});

describe('flyControls resetToDefault', () => {
  it('places camera behind gem along the root street axis', () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(999, 999, 999); // somewhere far away

    const cityScene = {
      // Gem at origin.
      getGemWorldPos: () => new THREE.Vector3(0, 0, 0),
      // Root street runs along world X with length 200, width 20.
      getRootStreet: () => ({
        x: 50,    // street center
        y: 0,     // street z-position
        orientation: StreetAxis.X,
        isRoot: true,
        width: 20,
        length: 200,
      }),
      getBbox: () => new THREE.Box3(new THREE.Vector3(-50, 0, -50), new THREE.Vector3(150, 30, 50)),
      getBuildings: () => [],
    };

    const fly = createFlyControls({
      camera,
      canvas: makeCanvas(),
      rig: makeFakeRig(),
      cityScene,
    });
    fly.resetToDefault();

    // Camera should sit behind the gem (in -X direction from gem, since
    // the street extends +X) and above the ground.
    expect(camera.position.x).toBeLessThan(0);
    expect(camera.position.y).toBeGreaterThanOrEqual(FLY_CONTROLS.get().ALTITUDE_FLOOR);
    // Camera should be roughly looking +X (down the street).
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    expect(dir.x).toBeGreaterThan(0.5);
  });

  it('falls back to bbox center when there is no gem', () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 0, 0);
    const cityScene = {
      getGemWorldPos: () => null,
      getRootStreet: () => null,
      getBbox: () => new THREE.Box3(new THREE.Vector3(-50, 0, -50), new THREE.Vector3(50, 30, 50)),
      getBuildings: () => [],
    };
    const fly = createFlyControls({
      camera,
      canvas: makeCanvas(),
      rig: makeFakeRig(),
      cityScene,
    });
    // Should not throw, should land at some non-zero altitude.
    expect(() => fly.resetToDefault()).not.toThrow();
    expect(camera.position.y).toBeGreaterThanOrEqual(FLY_CONTROLS.get().ALTITUDE_FLOOR);
  });
});

describe('flyControls idle quaternion passthrough', () => {
  it('does not overwrite camera quaternion when there is no input', () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 0, 0);
    camera.lookAt(0, 0, -1);
    camera.updateMatrixWorld();
    const fly = createFlyControls({
      camera, canvas: makeCanvas(), rig: makeFakeRig(), cityScene: makeFakeCityScene(),
    });
    fly.enable();
    // Let velocity fully decay to zero by running several idle frames.
    for (let i = 0; i < 30; i++) fly.update(16);
    // Externally rotate the camera (simulating a focus tween).
    camera.lookAt(10, 5, -5);
    camera.updateMatrixWorld();
    const externalQuat = camera.quaternion.clone();
    // One more idle frame — no mouse delta, no keys → fly mode should NOT overwrite quaternion.
    fly.update(16);
    expect(camera.quaternion.x).toBeCloseTo(externalQuat.x, 10);
    expect(camera.quaternion.y).toBeCloseTo(externalQuat.y, 10);
    expect(camera.quaternion.z).toBeCloseTo(externalQuat.z, 10);
    expect(camera.quaternion.w).toBeCloseTo(externalQuat.w, 10);
    fly.disable();
  });
});
