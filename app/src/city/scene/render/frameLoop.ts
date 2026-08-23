// city/render/frameLoop.ts — the requestAnimationFrame driver: before → rig →
// world matrices → each component.tick in the caller's order → after → render.
// One now() per frame; dt is 0 on the first. Sky must be passed LAST, since its
// camera-follow has to run immediately before postFx.render.

import type * as THREE from 'three';

import type { FrameContext, SceneComponent, SceneContext } from '../types';

/** Frame collaborators that are not SceneComponents. */
export interface PerFrame {
  /** Camera rig — update(0) runs first each frame (damping + one-shot framing).
   *  Owns the camera the frame projects through. */
  rig: { update(dtMs: number): void; camera: THREE.PerspectiveCamera };
  /** Post-processing pipeline — render() is the frame's final call. */
  postFx: { render(): void };
  /** Optional pre-rig hook — the composer's slot for per-frame work with no
   *  component home (canvas-size guard). */
  before?(frame: FrameContext): void;
  /** Optional post-tick hook, immediately before postFx.render(). */
  after?(frame: FrameContext): void;
}

/** Start the loop. The first frame runs synchronously (direct animate() call);
 *  subsequent frames re-arm via requestAnimationFrame. Returns stop(). */
export function startFrameLoop(
  components: readonly SceneComponent[],
  ctx: SceneContext,
  perFrame: PerFrame
): () => void {
  const startTime = performance.now();
  let lastTime: number | null = null;
  let rafId = 0;
  let running = true;

  function frame(): void {
    if (!running) return;
    const time = (performance.now() - startTime) / 1000;
    const dt = lastTime === null ? 0 : Math.max(0, time - lastTime);
    lastTime = time;
    const f: FrameContext = { dt, time, camera: perFrame.rig.camera };

    perFrame.before?.(f);
    perFrame.rig.update(0);
    // The camera moved, but its inverse is stale until a render: the ticks
    // below project mesh positions and need the matrices fresh.
    perFrame.rig.camera.updateMatrixWorld();
    ctx.scene.updateMatrixWorld();
    for (const c of components) c.tick?.(dt, f);
    perFrame.after?.(f);
    perFrame.postFx.render();
    rafId = requestAnimationFrame(frame);
  }

  frame();
  return function stop(): void {
    running = false;
    cancelAnimationFrame(rafId);
  };
}
