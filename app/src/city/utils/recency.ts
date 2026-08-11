// One scale for building colour and tree maturity, from age alone: one edit
// cannot restate another file. Hyperbolic, not a horizon, so there is no age
// past which everything looks identical.

const DAY_MS = 86_400_000;

/** 1 is freshest, approaching 0 and never reaching it; 0.5 at `halfLifeDays`.
 *  `nowMs` is the scan date in Live, the scrubbed commit in Timeline. An
 *  unreadable date takes the midpoint. */
export function recencyT(dateMs: number, nowMs: number, halfLifeDays: number): number {
  if (!Number.isFinite(dateMs)) return 0.5;
  const days = Math.max(0, (nowMs - dateMs) / DAY_MS);
  return 1 / (1 + days / Math.max(1, halfLifeDays));
}
