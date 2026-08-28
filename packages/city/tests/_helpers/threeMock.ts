// jsdom cannot create a WebGL context, so any test that builds a real city
// stubs the renderer and the post pipeline.
//
// Pull these in with `await import(...)` from inside the mock factory, not a
// top-level import: `vi.mock` hoists above the import block, so a top-level
// binding is not initialised yet when the factory runs.
//
// Import this module directly (`@codecity/city/testing/three`), never through
// the `@codecity/city/testing` barrel: the barrel reaches the city's source,
// which imports three, and a three mock factory awaiting that never resolves.

import type * as THREE from 'three';

/** Keeps exactly the methods createCity and the frame loop call. `getSize`
 *  fills the passed Vector2, making the per-frame size guard a no-op. Pass a
 *  spy to assert the GL context was released, not just its resources. */
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
