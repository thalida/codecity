// city/utils/reactiveRebuild.ts — run an async rebuild reactively, with
// supersession. An effect can't await, so this reads the signal deps
// synchronously (registering them) and fires the async body fire-and-forget,
// guarded by a per-instance generation token: each dep change bumps the
// generation, and the body must consult isCurrent() after every await and bail
// when a newer run has superseded it. This is the per-component move of the
// generation counter the manifest pipeline used to own centrally.

import { effect } from '@preact/signals';

export interface ReactiveRebuildHandle {
  dispose(): void;
}

/**
 * @param track Reads the signal deps synchronously and returns the snapshot the
 *   async `run` needs, or `null` to skip (e.g. layout not ready yet).
 * @param run Async rebuild. MUST check `isCurrent()` after each await and return
 *   early when it returns false, so a newer rebuild supersedes an in-flight one.
 * @param onError Handles a rejected `run` (default: console.warn) so it never escapes.
 */
export function reactiveRebuild<T>(
  track: () => T | null,
  run: (snapshot: T, isCurrent: () => boolean) => Promise<void>,
  onError?: (err: unknown) => void
): ReactiveRebuildHandle {
  let generation = 0;
  const dispose = effect(() => {
    const snapshot = track();
    if (snapshot == null) return;
    const myGen = ++generation;
    const isCurrent = (): boolean => myGen === generation;
    // Run in a microtask, OUTSIDE this effect's tracking context. track() above
    // already registered the deps; running synchronously here would put run()'s
    // own signal reads/writes inside the tracking scope, subscribing the effect
    // to signals it mutates → "Cycle detected". The microtask also lets the
    // current apply finish its synchronous work (e.g. bbox) before run reads it.
    void Promise.resolve().then(async () => {
      if (!isCurrent()) return;
      try {
        await run(snapshot, isCurrent);
      } catch (err) {
        if (onError) onError(err);
        else console.warn('[codecity] reactive rebuild failed', err);
      }
    });
  });
  return { dispose };
}
