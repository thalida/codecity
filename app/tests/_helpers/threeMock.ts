// jsdom cannot create a WebGL context, so any test that builds a real city has
// to stub the renderer and the post pipeline.
//
// These are imported from inside a `vi.mock` factory rather than at the top of
// the test file: `vi.mock` is hoisted above the import block, so a top-level
// import is not initialised yet when the factory runs. The factories are async,
// so `await import(...)` inside them resolves at mock time and is fine.

import type * as THREE from 'three';

/** Keeps exactly the methods createCity and the frame loop call. `getSize`
 *  fills the passed Vector2, which makes the per-frame size guard a no-op.
 *  Pass a spy to assert the GL context was released and not just its
 *  resources. */
export function fakeWebGLRenderer(onForceContextLoss: () => void = () => {}) {
  return class FakeWebGLRenderer {
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
      onForceContextLoss();
    }
    copyTextureToTexture() {}
    setRenderTarget() {}
    getContext() {
      return {};
    }
  };
}

/** The HDR bloom pipeline allocates GL render targets. */
export function postFxMock() {
  return {
    createPostFx: () => ({
      render: () => {},
      setSize: () => {},
      refresh: () => {},
      dispose: () => {},
    }),
  };
}
