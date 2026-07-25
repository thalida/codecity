// components/TimeTravelBar/scrubberScale.ts — pure date<->index mapping for the
// scrubber. Each commit gets a track position blending its point in TIME with its
// ORDINAL, so quiet stretches still spread and bursts still cluster, but no commit
// collapses onto its neighbour. SCRUB_POS stays a float COMMIT INDEX, so the scrub
// controller is unchanged. Commit dates are treated as non-decreasing (git commit
// order); a locally out-of-order date is clamped up so the axis stays well-ordered.

/**
 * How much ordinal spacing to mix into the time axis. Pure time (0) is unusable
 * on bursty repos: 100 commits in an hour of a 5-week history share ~1px and
 * can't be dragged apart. Pure ordinal (1) makes a 6-month gap look like a
 * 1-minute one. This keeps the time shape readable while guaranteeing every
 * commit a floor share of the track.
 */
const INDEX_WEIGHT = 0.35;

export interface ScrubberScale {
  /** Commit date ms, index-aligned, clamped non-decreasing. */
  ms: number[];
  /** Track fraction per commit, index-aligned and strictly increasing. */
  frac: number[];
}

export function buildScrubberScale(dates: string[]): ScrubberScale {
  const ms = dates.map((d) => Date.parse(d) || 0);
  for (let i = 1; i < ms.length; i++) if (ms[i] < ms[i - 1]) ms[i] = ms[i - 1];

  const n = ms.length;
  if (n === 0) return { ms, frac: [] };
  if (n === 1) return { ms, frac: [1] };

  // A single-instant history has no time axis to blend, so it falls back to
  // pure ordinal rather than collapsing every commit onto the left edge.
  const span = ms[n - 1] - ms[0];
  const w = span > 0 ? INDEX_WEIGHT : 1;
  const frac = ms.map((t, i) => {
    const byTime = span > 0 ? (t - ms[0]) / span : 0;
    return (1 - w) * byTime + w * (i / (n - 1));
  });
  return { ms, frac };
}

/** Track fraction [0,1] for a commit's own position (used to place its tick). */
export function commitFraction(scale: ScrubberScale, index: number): number {
  const { frac } = scale;
  if (frac.length === 0) return 0;
  return frac[Math.max(0, Math.min(frac.length - 1, Math.round(index)))];
}

/** Float commit index -> track fraction [0,1], lerped between its neighbours. */
export function indexToFraction(scale: ScrubberScale, pos: number): number {
  const { frac } = scale;
  if (frac.length === 0) return 0;
  const clamped = Math.max(0, Math.min(frac.length - 1, pos));
  const lo = Math.floor(clamped);
  const hi = Math.min(frac.length - 1, lo + 1);
  return frac[lo] + (frac[hi] - frac[lo]) * (clamped - lo);
}

/** Float commit index -> wall-clock ms, lerped between the bracketing commits.
 *  Track fraction can't be inverted back to time once the axis blends in the
 *  ordinal, so callers wanting "when is the handle" ask by index. */
export function indexToMs(scale: ScrubberScale, pos: number): number {
  const { ms } = scale;
  if (ms.length === 0) return 0;
  const clamped = Math.max(0, Math.min(ms.length - 1, pos));
  const lo = Math.floor(clamped);
  const hi = Math.min(ms.length - 1, lo + 1);
  return ms[lo] + (ms[hi] - ms[lo]) * (clamped - lo);
}

/** Track fraction [0,1] -> float commit index. Inverse of indexToFraction. */
export function fractionToIndex(scale: ScrubberScale, f: number): number {
  const { frac } = scale;
  const n = frac.length;
  if (n <= 1) return 0;
  const target = Math.max(0, Math.min(1, f));
  if (target <= frac[0]) return 0;
  if (target >= frac[n - 1]) return n - 1;

  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (frac[mid] <= target) lo = mid;
    else hi = mid;
  }
  const denom = frac[hi] - frac[lo];
  return denom > 0 ? lo + (target - frac[lo]) / denom : lo;
}
