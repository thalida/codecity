// city/index.test.ts — smoke test for the createCity composer. Asserts it
// builds without throwing on EMPTY_MANIFEST and returns the expected handle
// shape ({ world, picker, rig, focusByPath }).
//
// jsdom has no WebGL context, so a real THREE.WebGLRenderer + the bloom post
// pipeline can't run here (no other test constructs a real renderer either —
// the component tests pass a fake `{ domElement: canvas }`). We mock the
// renderer, the post-fx pipeline, and the ad-panel renderer registration so
// createCity's full construction order (component build → boot applyManifest →
// rig/picker/inputHandlers → frame loop) is exercised end to end. The layout
// runs through the sync in-process fallback (Worker is undefined in jsdom).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { EMPTY_MANIFEST } from '@/constants/manifest';
import { TIMELINE_MODE } from '@/state/stores/timeline';

// Stub the WebGLRenderer — jsdom can't create a GL context. Keep the methods
// createCity / the frame loop call (setPixelRatio/setSize/getSize/render/
// domElement); getSize fills the passed Vector2 so the per-frame size guard
// is a no-op.
const { forceContextLossSpy } = vi.hoisted(() => ({ forceContextLossSpy: vi.fn() }));

vi.mock('three', async () => {
  const actual = await vi.importActual<typeof import('three')>('three');
  class FakeWebGLRenderer {
    domElement: HTMLCanvasElement;
    constructor(opts: { canvas: HTMLCanvasElement }) {
      this.domElement = opts.canvas;
    }
    setPixelRatio() {}
    setSize() {}
    getSize(v: THREE.Vector2) {
      return v;
    }
    render() {}
    dispose() {}
    forceContextLoss() {
      forceContextLossSpy();
    }
    copyTextureToTexture() {}
    setRenderTarget() {}
    getContext() {
      return {};
    }
  }
  return { ...actual, WebGLRenderer: FakeWebGLRenderer };
});

// The HDR bloom pipeline allocates GL render targets — stub it.
vi.mock('@/city/render/postFx', () => ({
  createPostFx: () => ({
    render: () => {},
    setSize: () => {},
    refresh: () => {},
    dispose: () => {},
  }),
}));

import { createCity } from '@/city/index';

describe('createCity', () => {
  let rafSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // applyManifest's deferred decoration pass awaits a real rAF, so the stub
    // must actually fire its callback (a no-op stub hangs the boot apply). The
    // frame loop also self-arms via rAF; cap total invocations so the loop runs
    // a few frames then stops instead of recursing forever.
    let calls = 0;
    rafSpy = vi
      .spyOn(globalThis, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback) => {
        if (calls++ < 8) setTimeout(() => cb(performance.now()), 0);
        return 0 as unknown as number;
      });
  });

  afterEach(() => {
    rafSpy.mockRestore();
    vi.clearAllMocks();
    TIMELINE_MODE.value = false;
  });

  function makeCanvas(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    // jsdom returns 0 for clientWidth/Height; give the rig a non-degenerate
    // viewport so aspect math doesn't divide by zero.
    Object.defineProperty(canvas, 'clientWidth', { value: 1280, configurable: true });
    Object.defineProperty(canvas, 'clientHeight', { value: 720, configurable: true });
    return canvas;
  }

  it('builds on EMPTY_MANIFEST and returns the expected handle shape', async () => {
    const handle = await createCity(makeCanvas(), EMPTY_MANIFEST);

    expect(handle.world).toBeDefined();
    expect(handle.picker).toBeDefined();
    expect(handle.rig).toBeDefined();
    expect(typeof handle.rig.reset).toBe('function');
    expect(typeof handle.focusByPath).toBe('function');
  });

  it('dispose() releases the WebGL context (forceContextLoss), not just its resources', async () => {
    const handle = await createCity(makeCanvas(), EMPTY_MANIFEST);
    expect(forceContextLossSpy).not.toHaveBeenCalled();
    handle.dispose();
    expect(forceContextLossSpy).toHaveBeenCalled();
  });

  // Issue #113: a source switch used to leave the union city + scrub controller
  // stuck on the newly loaded repo. useManifestSource.loadSource now flips
  // TIMELINE_MODE off directly (scene-free); this effect is what actually tears
  // the scene down, uniformly for the toggle button AND a source switch.
  describe('Timeline-mode scene teardown', () => {
    // What each subsystem does to restore itself is its own test; uninstall
    // walks every ModeDrivable, so this only has to prove the walk happens.
    it('reacts to TIMELINE_MODE going true→false by uninstalling the controller', async () => {
      const handle = await createCity(makeCanvas(), EMPTY_MANIFEST);
      handle.timeline.installScrubController(new Map(), []);
      const uninstallSpy = vi.spyOn(handle.timeline, 'uninstallScrubController');

      TIMELINE_MODE.value = true; // entering must not trip the teardown
      expect(uninstallSpy).not.toHaveBeenCalled();

      TIMELINE_MODE.value = false; // same flip a source switch performs
      expect(uninstallSpy).toHaveBeenCalledTimes(1);

      handle.dispose();
    });

    it('no-ops when no controller was ever installed', async () => {
      const handle = await createCity(makeCanvas(), EMPTY_MANIFEST);
      const uninstallSpy = vi.spyOn(handle.timeline, 'uninstallScrubController');

      TIMELINE_MODE.value = true;
      TIMELINE_MODE.value = false;

      expect(uninstallSpy).not.toHaveBeenCalled();
      handle.dispose();
    });
  });
});
