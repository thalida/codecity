// Shared Preact render-settling helpers for view tests. Preact schedules signal-driven re-
// renders on the microtask queue, so most tests only need a single yield after dispatching an
// event before reading the DOM. Use flush() for that.

/** Yield once to let Preact flush a microtask-scheduled re-render. Sufficient for synchronous-
 *  ish signal/state updates triggered by an event. */
export const flush = (): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Settle a render that depends on async work (a fetch() chain → useState → Preact's macrotask
 *  re-render). Alternates a microtask drain with a macrotask yield for `rounds` iterations. */
export const drainAsync = async (rounds = 25, delayMs = 0): Promise<void> => {
  for (let round = 0; round < rounds; round++) {
    await Promise.resolve();
    await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
  }
};
