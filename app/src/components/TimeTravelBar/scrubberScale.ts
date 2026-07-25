// Pure date<->index mapping for the scrubber. Track position blends each commit's
// point in time with its ordinal; SCRUB_POS stays a float commit index.

export interface ScrubberScale {
  /** Commit date ms, index-aligned, clamped non-decreasing. */
  ms: number[];
  /** Track fraction per commit, index-aligned and strictly increasing. */
  frac: number[];
}

/** `indexWeight` 0 = place commits purely by time, 1 = purely by ordinal. */
export function buildScrubberScale(dates: string[], indexWeight = 0): ScrubberScale {
  const ms = dates.map((d) => Date.parse(d) || 0);
  for (let i = 1; i < ms.length; i++) if (ms[i] < ms[i - 1]) ms[i] = ms[i - 1];

  const n = ms.length;
  if (n === 0) return { ms, frac: [] };
  if (n === 1) return { ms, frac: [1] };

  // A single-instant history has no time axis to blend, so it falls back to
  // pure ordinal rather than collapsing every commit onto the left edge.
  const span = ms[n - 1] - ms[0];
  const w = span > 0 ? indexWeight : 1;
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

/** Float commit index -> wall-clock ms. Ask by index: track fraction is no
 *  longer invertible to time once the ordinal is blended in. */
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
