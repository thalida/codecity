// city/utils/nextPaint.ts — yield until the browser has actually painted.
// Awaited before a long synchronous stretch (mesh assembly, the tree placement
// scan), so what the UI says about that work is visible before the thread locks.

/** Resolves once the pending frame is on screen: rAF starts the next frame, the
 *  0ms timeout lands after the browser has COMPLETED it. */
export function nextPaint(): Promise<void> {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      setTimeout(resolve, 0);
    });
  });
}
