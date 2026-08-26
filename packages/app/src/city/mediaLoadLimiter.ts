/** Caps how many facade images and videos load at once, queueing the rest.
 *
 *  This is the one piece of cross-city state that SHOULD stay cross-city: what
 *  it protects is the page's connection pool and main thread, and two cities on
 *  one page do not get twice the bandwidth.
 *
 *  It is an object rather than a module `let` so the sharing is declared. An
 *  invisible global is invisible whether or not sharing it is correct, and the
 *  ceiling becomes tunable — a consumer that wants one city loading
 *  independently of another passes its own limiter in.
 */
export interface MediaLoadLimiter {
  /** Resolves once a slot is free. Every acquire must be paired with a release. */
  acquire(): Promise<void>;
  release(): void;
}

export function createMediaLoadLimiter(maxConcurrent = 4): MediaLoadLimiter {
  let inFlight = 0;
  const pending: Array<() => void> = [];

  return {
    acquire(): Promise<void> {
      if (inFlight < maxConcurrent) {
        inFlight++;
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => {
        pending.push(() => {
          inFlight++;
          resolve();
        });
      });
    },
    release(): void {
      inFlight--;
      const next = pending.shift();
      if (next) next();
    },
  };
}

/** The default every city shares unless handed one of its own. */
export const SHARED_MEDIA_LOAD_LIMITER = createMediaLoadLimiter();
