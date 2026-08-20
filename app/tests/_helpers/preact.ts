// Shared Preact render-settling helpers for view tests.
//
// Preact schedules signal-driven re-renders on the microtask queue, so most
// tests only need a single yield after dispatching an event before reading
// the DOM. Use flush() for that.
//
// A few panes settle a render through interleaved schedulers — an async fetch
// chain (fetch() -> resp.json()/resp.text(), a run of microtasks) and the
// resulting useState/effect change that Preact picks up on a macrotask.
// Draining only one queue races the other (flaky body asserts), so use
// drainAsync(), which alternates a microtask drain with a macrotask yield,
// repeated enough times to deterministically cover the fetch + re-render hops.

/**
 * Yield once to let Preact flush a microtask-scheduled re-render.
 * Sufficient for synchronous-ish signal/state updates triggered by an event.
 */
export const flush = (): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Settle a render that depends on async work (a fetch() chain → useState →
 * Preact's macrotask re-render). Alternates a microtask drain with a macrotask
 * yield for `rounds` iterations. The exact hop count varies (jsdom
 * Response.json/text defer; reject paths are longer), so it drains generously
 * rather than guess a minimal count. `delayMs` defaults to 0 (a setTimeout(0)
 * yield, ~1ms) — cheap; pass a larger delay only for a caller that genuinely
 * waits on a timer (e.g. jsdom rAF's ~16ms).
 */
export const drainAsync = async (rounds = 25, delayMs = 0): Promise<void> => {
  for (let round = 0; round < rounds; round++) {
    await Promise.resolve();
    await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
  }
};
