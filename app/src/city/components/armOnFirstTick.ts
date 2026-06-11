// city/components/armOnFirstTick.ts — shared "arm picker-dependent work on the
// first tick" lifecycle. Components are constructed before ctx.picker/.renderer
// exist; this defers their picker-driven setup to the first tick() once those
// are live, runs it exactly once, and survives dispose() (the sticky `armed`
// flag is never reset, so a stray post-dispose tick cannot re-arm). Replaces the
// hand-copied _armed/_interactionsArmed boolean + guard in buildings/streets/
// fireflies/trees/pathLine.
import type { SceneContext } from '../types';

export interface FirstTickArm {
  /** Call from tick(): runs setup() exactly once, after ctx.picker (and
   *  ctx.renderer when needsRenderer) are live. No-op once armed. */
  arm(): void;
  /** Run setup()'s teardowns (idempotent; safe to call before arm()). */
  dispose(): void;
}

export function armOnFirstTick(
  ctx: SceneContext,
  setup: () => Array<() => void>,
  opts: { needsRenderer?: boolean } = {}
): FirstTickArm {
  let armed = false;
  let teardowns: Array<() => void> = [];
  return {
    arm(): void {
      if (armed || !ctx.picker || (opts.needsRenderer && !ctx.renderer)) return;
      armed = true;
      teardowns = setup();
    },
    dispose(): void {
      for (const t of teardowns) t();
      teardowns = [];
    },
  };
}
