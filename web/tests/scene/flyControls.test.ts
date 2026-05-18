import * as THREE from 'three';
import { describe, it, expect, vi } from 'vitest';
import { createFlyControls, type FlyControlsCityScene } from '@/scene/flyControls.js';

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
