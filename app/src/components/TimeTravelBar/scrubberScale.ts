// components/TimeTravelBar/scrubberScale.ts — pure date<->index mapping for the
// time-based scrubber. The track axis is TIME (so busy periods cluster and quiet
// stretches spread, like a photo-library scrubber), but SCRUB_POS stays a float
// COMMIT INDEX so the scrub controller is unchanged. Commit dates are treated as
// non-decreasing (git commit order); a locally out-of-order date is clamped up so
// the axis and the binary search stay well-ordered.

export interface ScrubberScale {
  /** Commit date ms, index-aligned, clamped non-decreasing. */
  ms: number[];
  minMs: number;
  maxMs: number;
  /** maxMs - minMs, floored at 1 so a single-day repo never divides by zero. */
  span: number;
  /** True when every commit shares one instant (day-precision dates, so a repo
   *  whose whole history is one calendar day). The time axis can't separate them,
   *  so the mappings fall back to even INDEX spacing — otherwise the handle would
   *  collapse to the left edge and you couldn't scrub. */
  degenerate: boolean;
}

export function buildScrubberScale(dates: string[]): ScrubberScale {
  const ms = dates.map((d) => Date.parse(d) || 0);
  for (let i = 1; i < ms.length; i++) if (ms[i] < ms[i - 1]) ms[i] = ms[i - 1];
  const minMs = ms.length ? ms[0] : 0;
  const maxMs = ms.length ? ms[ms.length - 1] : 0;
  return { ms, minMs, maxMs, span: Math.max(1, maxMs - minMs), degenerate: maxMs === minMs };
}

/** Even index spacing for a degenerate axis: index 0 at the left, the last at the
 *  right. A lone commit is the present, pinned to the right edge. */
function indexFraction(n: number, pos: number): number {
  if (n <= 1) return n === 1 ? 1 : 0;
  return Math.max(0, Math.min(1, pos / (n - 1)));
}

/** Track fraction [0,1] for a commit's own date (used to place its tick). */
export function commitFraction(scale: ScrubberScale, index: number): number {
  const { ms, minMs, span, degenerate } = scale;
  if (ms.length === 0) return 0;
  if (degenerate) return indexFraction(ms.length, index);
  const i = Math.max(0, Math.min(ms.length - 1, index));
  return Math.max(0, Math.min(1, (ms[i] - minMs) / span));
}

/** Float commit index -> track fraction [0,1], interpolating the DATE between the
 *  two bracketing commits so the handle sits at its real point in time. */
export function indexToFraction(scale: ScrubberScale, pos: number): number {
  const { ms, minMs, span, degenerate } = scale;
  if (ms.length === 0) return 0;
  if (degenerate) return indexFraction(ms.length, pos);
  const clamped = Math.max(0, Math.min(ms.length - 1, pos));
  const lo = Math.floor(clamped);
  const hi = Math.min(ms.length - 1, lo + 1);
  const at = ms[lo] + (ms[hi] - ms[lo]) * (clamped - lo);
  return Math.max(0, Math.min(1, (at - minMs) / span));
}

/** Track fraction [0,1] -> float commit index. By DATE on a real time span
 *  (binary-search + lerp within the bracketing pair); by even index spacing on a
 *  degenerate one, so a same-day repo scrubs across all its commits. */
export function fractionToIndex(scale: ScrubberScale, frac: number): number {
  const { ms, minMs, span, degenerate } = scale;
  const n = ms.length;
  if (n <= 1) return 0;
  if (degenerate) return Math.max(0, Math.min(1, frac)) * (n - 1);
  const target = minMs + Math.max(0, Math.min(1, frac)) * span;
  if (target <= ms[0]) return 0;
  if (target >= ms[n - 1]) return n - 1;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (ms[mid] <= target) lo = mid;
    else hi = mid;
  }
  const denom = ms[hi] - ms[lo];
  return denom > 0 ? lo + (target - ms[lo]) / denom : lo;
}
