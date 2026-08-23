// utils/until.ts — await a signal condition. Two places had grown their own
// effect-and-resolve dance (a scene appearing, a frame landing), and one of
// them kept a queue of callbacks to fan out to.

import { effect } from '@preact/signals';

/** Resolves as soon as `holds()` is true, reading it through the signals it
 *  touches. Already true: resolves without waiting a tick. */
export function until(holds: () => boolean): Promise<void> {
  if (holds()) return Promise.resolve();
  return new Promise((resolve) => {
    let stop: (() => void) | null = null;
    let done = false;
    stop = effect(() => {
      if (!holds() || done) return;
      done = true;
      // Out of the effect's own run: disposing it from inside its body is a
      // write during the flush, and `stop` is still being assigned besides.
      queueMicrotask(() => {
        stop?.();
        resolve();
      });
    });
  });
}
