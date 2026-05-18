import * as THREE from 'three';
import { describe, it, expect, vi } from 'vitest';
import { createFlyControls } from '@/scene/flyControls.js';

function makeFakeRig() {
  return {
    controls: { enabled: true } as { enabled: boolean },
  };
}

function makeFakeCityScene() {
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
      cityScene: makeFakeCityScene() as never,
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
      cityScene: makeFakeCityScene() as never,
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
      cityScene: makeFakeCityScene() as never,
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
      cityScene: makeFakeCityScene() as never,
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
