// city/utils/armOnFirstTick.ts — shared "arm picker-dependent work on the
// first tick" lifecycle. Components are constructed before ctx.picker exists
// (picker.world reads their handles, so it's built after them); this defers
// their picker-driven setup to the first tick() once ctx.picker is live, runs
// it exactly once, and survives dispose() (the sticky `armed` flag is never
// reset, so a stray post-dispose tick cannot re-arm).
import type { SceneContext } from '@/city/types';

export interface FirstTickArm {
  /** Call from tick(): runs setup() exactly once, after ctx.picker is live.
   *  No-op once armed. */
  arm(): void;
  /** Run setup()'s teardowns (idempotent; safe to call before arm()). */
  dispose(): void;
}

export function armOnFirstTick(ctx: SceneContext, setup: () => Array<() => void>): FirstTickArm {
  let armed = false;
  let teardowns: Array<() => void> = [];
  return {
    arm(): void {
      if (armed || !ctx.picker) return;
      armed = true;
      teardowns = setup();
    },
    dispose(): void {
      for (const t of teardowns) t();
      teardowns = [];
    },
  };
}
