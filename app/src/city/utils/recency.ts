// How recent a dated thing is, on one scale shared by building colour and tree
// maturity. Depends only on the thing's own age, so editing one file cannot
// restate any other, and two repos are directly comparable.
//
// Hyperbolic rather than a horizon: freshness keeps falling forever instead of
// hitting a wall, so there is no age past which everything looks identical. The
// tail is fat enough to still separate a one-year file from a ten-year one.

const DAY_MS = 86_400_000;

/**
 * 1 is freshest, approaching 0 with age and never reaching it. At
 * `halfLifeDays` old a thing sits at exactly 0.5.
 *
 * `nowMs` is the moment measured against: the scan date in Live, and the commit
 * under the scrubber in Timeline, so a city scrubbed to its first commit reads
 * new rather than uniformly ancient.
 *
 * An unparseable date has no age, so it takes the midpoint rather than
 * pretending to be new or old.
 */
export function recencyT(dateMs: number, nowMs: number, halfLifeDays: number): number {
  if (!Number.isFinite(dateMs)) return 0.5;
  const days = Math.max(0, (nowMs - dateMs) / DAY_MS);
  return 1 / (1 + days / Math.max(1, halfLifeDays));
}
