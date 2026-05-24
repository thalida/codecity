import * as THREE from 'three';
import { describe, it, expect, vi } from 'vitest';
import { createFlyControls, type FlyControlsWorld } from '@/scene/system/flyControls.js';
import { StreetAxis } from '@/types';

function makeFakeRig() {
  return {
    controls: {
      enabled: true,
      target: new THREE.Vector3(),
    },
  };
}

function makeFakeWorld(): FlyControlsWorld {
  return {
    getGemWorldPos: () => null,
    getRootStreet: () => null,
    getBbox: () => new THREE.Box3(new THREE.Vector3(-50, 0, -50), new THREE.Vector3(50, 10, 50)),
    getWorldBounds: () => null,
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
      cityScene: makeFakeWorld(),
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
      cityScene: makeFakeWorld(),
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
      cityScene: makeFakeWorld(),
    });
    fly.enable();
    fly.disable();
    expect(fly.isActive()).toBe(false);
    expect(rig.controls.enabled).toBe(true);
  });

  it('disable() puts the pivot on the camera forward ray (no view snap)', () => {
    // Looking horizontally → forward ray never hits y=0 ahead, so the
    // pivot floats at the fallback distance along the forward ray.
    // Crucially, pivot is ON the forward ray, so OrbitControls'
    // lookAt(target) is a no-op and the camera doesn't snap.
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(10, 8, 5);
    camera.lookAt(10, 8, -100); // forward = -Z, horizontal
    camera.updateMatrixWorld();
    const rig = makeFakeRig();
    const fly = createFlyControls({
      camera,
      canvas: makeCanvas(),
      rig,
      cityScene: makeFakeWorld(),
    });
    fly.enable();
    fly.disable();
    expect(rig.controls.target.x).toBeCloseTo(10, 2);
    expect(rig.controls.target.y).toBeCloseTo(8, 2); // along ray, Y unchanged
    expect(rig.controls.target.z).toBeLessThan(camera.position.z); // ahead of camera
  });

  it('disable() lands pivot on the floor when forward ray hits y=0', () => {
    // Looking down-forward at (10, 0, -10) from (10, 20, 0). Forward
    // ray crosses y=0 at z = -10 → pivot lands on the floor at the
    // exact spot the user was looking at, on the forward ray.
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(10, 20, 0);
    camera.lookAt(10, 0, -10);
    camera.updateMatrixWorld();
    const rig = makeFakeRig();
    const fly = createFlyControls({
      camera,
      canvas: makeCanvas(),
      rig,
      cityScene: makeFakeWorld(),
    });
    fly.enable();
    fly.disable();
    expect(rig.controls.target.y).toBeCloseTo(0, 2);
    expect(rig.controls.target.x).toBeCloseTo(10, 2);
    expect(rig.controls.target.z).toBeLessThan(camera.position.z);
  });

  it('onActiveChange callback fires on enable and disable', () => {
    const camera = new THREE.PerspectiveCamera();
    const fly = createFlyControls({
      camera,
      canvas: makeCanvas(),
      rig: makeFakeRig(),
      cityScene: makeFakeWorld(),
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
      cityScene: makeFakeWorld(),
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
      cityScene: makeFakeWorld(),
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
      cityScene: makeFakeWorld(),
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
      cityScene: makeFakeWorld(),
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
      cityScene: makeFakeWorld(),
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
      cityScene: makeFakeWorld(),
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
      cityScene: makeFakeWorld(),
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

  it('A strafes left (-X)', () => {
    const { camera, fly } = setup();
    fly.enable();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    for (let i = 0; i < 30; i++) fly.update(16);
    expect(camera.position.x).toBeLessThan(-1);
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

  it('Q moves the camera down (-Y)', () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 20, 0); // start high enough that Q can move freely
    camera.lookAt(0, 20, -1);
    camera.updateMatrixWorld();
    const fly = createFlyControls({
      camera, canvas: makeCanvas(), rig: makeFakeRig(), cityScene: makeFakeWorld(),
    });
    fly.enable();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'q' }));
    for (let i = 0; i < 30; i++) fly.update(16);
    expect(camera.position.y).toBeLessThan(20);
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
      cityScene: makeFakeWorld(),
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
      cityScene: makeFakeWorld(),
    });
    // Don't enable.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' }));
    fly.update(16);
    expect(camera.position.z).toBe(0);
  });
});

describe('flyControls mouse look', () => {
  it('mousemove rotates yaw/pitch while left-mouse is held (drag-to-look)', () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 0, 0);
    camera.lookAt(0, 0, -1);
    camera.updateMatrixWorld();
    const canvas = makeCanvas();
    const fly = createFlyControls({
      camera,
      canvas,
      rig: makeFakeRig(),
      cityScene: makeFakeWorld(),
    });
    fly.enable();
    const before = new THREE.Vector3();
    camera.getWorldDirection(before);
    canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
    canvas.dispatchEvent(new MouseEvent('mousemove', { movementX: 100, movementY: 0 }));
    fly.update(16);
    const after = new THREE.Vector3();
    camera.getWorldDirection(after);
    expect(after.x).not.toBeCloseTo(before.x, 4);
    document.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
    fly.disable();
  });

  it('mousemove rotates yaw/pitch while right-mouse is held', () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 0, 0);
    camera.lookAt(0, 0, -1);
    camera.updateMatrixWorld();
    const canvas = makeCanvas();
    const fly = createFlyControls({
      camera,
      canvas,
      rig: makeFakeRig(),
      cityScene: makeFakeWorld(),
    });
    fly.enable();
    const before = new THREE.Vector3();
    camera.getWorldDirection(before);
    canvas.dispatchEvent(new MouseEvent('mousedown', { button: 2 }));
    canvas.dispatchEvent(new MouseEvent('mousemove', { movementX: 100, movementY: 0 }));
    fly.update(16);
    const after = new THREE.Vector3();
    camera.getWorldDirection(after);
    expect(after.x).not.toBeCloseTo(before.x, 4);
    document.dispatchEvent(new MouseEvent('mouseup', { button: 2 }));
    fly.disable();
  });

  it('ignores mousemove when right-mouse is NOT held', () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 0, 0);
    camera.lookAt(0, 0, -1);
    camera.updateMatrixWorld();
    const canvas = makeCanvas();
    const fly = createFlyControls({
      camera, canvas, rig: makeFakeRig(), cityScene: makeFakeWorld(),
    });
    fly.enable();
    const before = new THREE.Quaternion().copy(camera.quaternion);
    // No mousedown — moving the mouse should not rotate the camera.
    canvas.dispatchEvent(new MouseEvent('mousemove', { movementX: 500, movementY: 500 }));
    fly.update(16);
    expect(camera.quaternion.equals(before)).toBe(true);
    fly.disable();
  });

  it('pitch clamps to ±PITCH_CLAMP_DEG while looking', () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 0, 0);
    camera.lookAt(0, 0, -1);
    camera.updateMatrixWorld();
    const canvas = makeCanvas();
    const fly = createFlyControls({
      camera,
      canvas,
      rig: makeFakeRig(),
      cityScene: makeFakeWorld(),
    });
    fly.enable();
    canvas.dispatchEvent(new MouseEvent('mousedown', { button: 2 }));
    for (let i = 0; i < 100; i++) {
      canvas.dispatchEvent(new MouseEvent('mousemove', { movementX: 0, movementY: -10000 }));
      fly.update(16);
    }
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    expect(dir.y).toBeLessThan(0.999);
    expect(dir.y).toBeGreaterThan(0.99);
    document.dispatchEvent(new MouseEvent('mouseup', { button: 2 }));
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
      cityScene: makeFakeWorld(),
    });
    // Not enabled — listeners not attached, so even RMB+move does nothing.
    canvas.dispatchEvent(new MouseEvent('mousedown', { button: 2 }));
    canvas.dispatchEvent(new MouseEvent('mousemove', { movementX: 500, movementY: 500 }));
    expect(camera.quaternion.equals(before)).toBe(true);
  });
});

describe('flyControls resetToDefault', () => {
  it('places camera above and behind gem looking down the root road', () => {
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
      getWorldBounds: () => null,
    };

    const fly = createFlyControls({
      camera,
      canvas: makeCanvas(),
      rig: makeFakeRig(),
      cityScene,
    });
    fly.resetToDefault();

    // Camera sits BEHIND the gem (negative X, opposite the +X road
    // direction) at altitude. Z stays aligned with the gem.
    expect(camera.position.x).toBeLessThan(0);
    expect(camera.position.z).toBeCloseTo(0, 5);
    expect(camera.position.y).toBeGreaterThanOrEqual(10);
    // Camera looks down the road — forward direction is dominated by
    // the +X axis (toward the road end), with only a slight downward tilt.
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    expect(dir.x).toBeGreaterThan(0.9);   // mostly forward
    expect(dir.y).toBeLessThan(0);         // slight downward
    expect(dir.y).toBeGreaterThan(-0.3);  // but not steeply down

    // Sanity check: the gem (at origin) lies in front of the camera —
    // i.e. projecting the camera-to-gem vector onto forward is positive.
    const camToGem = new THREE.Vector3(0, 0, 0).sub(camera.position);
    expect(camToGem.dot(dir)).toBeGreaterThan(0);
  });

  it('falls back to bbox center when there is no gem', () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 0, 0);
    const cityScene = {
      getGemWorldPos: () => null,
      getRootStreet: () => null,
      getBbox: () => new THREE.Box3(new THREE.Vector3(-50, 0, -50), new THREE.Vector3(50, 30, 50)),
      getWorldBounds: () => null,
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
      camera, canvas: makeCanvas(), rig: makeFakeRig(), cityScene: makeFakeWorld(),
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
