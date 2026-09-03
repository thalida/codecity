// city/render/frameLoop.ts — generic requestAnimationFrame driver. Wired by
// createCity (city/index.ts) as the scene's live loop:
// perFrame.before → rig.update → world-matrix refresh → each
// component.tick(dt, frame) in array order → perFrame.after → postFx.render.
//
// dt/time contract: one performance.now()
// sample per frame; time = seconds since start; dt = 0 on the first frame,
// else clamped non-negative delta. Tick order is the caller's components-array
// order (sky must be passed LAST — its camera-follow must run immediately
// before postFx.render).

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

/** How many frames in a row may throw before the loop gives up. One is a
 *  transient — a texture that arrived half-uploaded, a resize mid-tick — and
 *  the next frame usually clears it. A run this long is a broken build, and
 *  re-entering it 60 times a second only burns the battery. */
const CONSECUTIVE_FRAME_ERROR_LIMIT = 10;

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
  let consecutiveErrors = 0;

  function drawFrame(): void {
    const time = (performance.now() - startTime) / 1000;
    const dt = lastTime === null ? 0 : Math.max(0, time - lastTime);
    lastTime = time;
    const f: FrameContext = { dt, time, camera: perFrame.rig.camera };

    perFrame.before?.(f);
    perFrame.rig.update(0);
    // controls.update() moves the camera but matrixWorldInverse is stale until
    // a render runs; ticks below project mesh positions and need fresh world
    // matrices.
    perFrame.rig.camera.updateMatrixWorld();
    ctx.scene.updateMatrixWorld();
    for (const c of components) c.tick?.(dt, f);
    perFrame.after?.(f);
    perFrame.postFx.render();
  }

  function frame(): void {
    if (!running) return;
    // Re-armed BEFORE the work, not after. A throw anywhere below used to skip
    // the last statement of this function, which was the re-arm — so one bad
    // property access in one component's tick() stopped every subsequent frame
    // for the life of the page, and the city just sat there.
    rafId = requestAnimationFrame(frame);
    try {
      drawFrame();
      consecutiveErrors = 0;
    } catch (err) {
      // Reported every time: a frame loop that eats exceptions is how a
      // one-line bug reads as "the renderer is slow". The count is what keeps
      // that from being 60 identical lines a second forever.
      console.error('[codecity] frame failed', err);
      if (++consecutiveErrors >= CONSECUTIVE_FRAME_ERROR_LIMIT) {
        console.error(`[codecity] ${consecutiveErrors} frames failed in a row; stopping the loop`);
        running = false;
        cancelAnimationFrame(rafId);
      }
    }
  }

  frame();
  return function stop(): void {
    running = false;
    cancelAnimationFrame(rafId);
  };
}
