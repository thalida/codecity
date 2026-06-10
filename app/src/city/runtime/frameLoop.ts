// city/runtime/frameLoop.ts — generic requestAnimationFrame driver (Task 13).
// Replaces renderLoop.animate()'s hand-rolled loop when the Task 15 composer
// wires it: perFrame.before → rig.update → world-matrix refresh → each
// component.tick(dt, frame) in array order → perFrame.after → postFx.render.
// UNWIRED until Task 15 — renderLoop.animate() remains the live loop.
//
// dt/time contract (mirrors animate()'s _skyDt block): one performance.now()
// sample per frame; time = seconds since start; dt = 0 on the first frame,
// else clamped non-negative delta. Tick order is the caller's components-array
// order (sky must be passed LAST — its camera-follow must run immediately
// before postFx.render).

import type { FrameContext, SceneComponent, SceneContext } from '../types';

/** Frame collaborators that are not SceneComponents. */
export interface PerFrame {
  /** Camera rig — update(0) runs first each frame (damping + one-shot framing). */
  rig: { update(dtMs: number): void };
  /** Post-processing pipeline — render() is the frame's final call. */
  postFx: { render(): void };
  /** Optional pre-rig hook — the composer's slot for per-frame work with no
   *  component home (canvas-size guard; fireflies.setTime until Task 14). */
  before?(frame: FrameContext): void;
  /** Optional post-tick hook, immediately before postFx.render(). */
  after?(frame: FrameContext): void;
}

/** Start the loop. The first frame runs synchronously (matching renderLoop's
 *  direct animate() call); subsequent frames re-arm via requestAnimationFrame.
 *  Returns stop(). */
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
    const f: FrameContext = { dt, time, camera: ctx.camera };

    perFrame.before?.(f);
    perFrame.rig.update(0);
    // controls.update() moves the camera but matrixWorldInverse is stale until
    // a render runs; ticks below project mesh positions and need fresh world
    // matrices.
    ctx.camera.updateMatrixWorld();
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
