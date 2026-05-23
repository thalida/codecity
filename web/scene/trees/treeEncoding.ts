// scene/trees/treeEncoding.ts — pure helpers turning commit metadata
// into [0,1] normalized signals (age / size / commit-gap). The
// renderer uses these to pick per-tree heights, widths, and colors.
//
// Robust to:
//   - null commits (non-git roots)
//   - empty commits arrays (git roots with no commits in window)
//   - degenerate ranges (all-same-date / -files / -gaps → collapse to t=0.5)
//   - out-of-range inputs (clamp to [0,1])
//
// Date math is day-precision because the scanner emits YYYY-MM-DD.

import type { CommitEntry } from '@/types';

export interface AgeRange {
  /** Epoch days of the oldest commit. */
  oldest: number;
  /** Epoch days of the newest commit. */
  newest: number;
  /** newest - oldest. 0 when there is no meaningful range. */
  span: number;
}

export interface SizeRange {
  min: number;
  max: number;
  /** max - min. 0 when there is no meaningful range. */
  span: number;
}

export interface GapRange {
  /** Smallest gap (in days) between adjacent commits. */
  min: number;
  /** Largest gap (in days) between adjacent commits. */
  max: number;
  /** max - min. 0 when there is no meaningful range. */
  span: number;
}

export interface CommitGaps {
  /** Per-commit gap to the previous commit in days. gaps[0] = 0 (no
   *  previous commit — consumers should treat commit 0 as "no gap
   *  signal" via gapTByIndex). */
  gaps: number[];
  range: GapRange;
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/** Convert a YYYY-MM-DD string to integer epoch days. */
function dateToDays(date: string): number {
  const ms = Date.parse(date);
  if (Number.isNaN(ms)) return 0;
  return Math.floor(ms / MS_PER_DAY);
}

function clamp01(t: number): number {
  if (t < 0) return 0;
  if (t > 1) return 1;
  return t;
}

export function computeAgeRange(commits: CommitEntry[] | null): AgeRange {
  if (!commits || commits.length === 0) {
    return { oldest: 0, newest: 0, span: 0 };
  }
  let oldest = dateToDays(commits[0].date);
  let newest = oldest;
  for (let i = 1; i < commits.length; i++) {
    const d = dateToDays(commits[i].date);
    if (d < oldest) oldest = d;
    if (d > newest) newest = d;
  }
  return { oldest, newest, span: newest - oldest };
}

export function computeSizeRange(commits: CommitEntry[] | null): SizeRange {
  if (!commits || commits.length === 0) {
    return { min: 0, max: 0, span: 0 };
  }
  let min = commits[0].files;
  let max = min;
  for (let i = 1; i < commits.length; i++) {
    const f = commits[i].files;
    if (f < min) min = f;
    if (f > max) max = f;
  }
  return { min, max, span: max - min };
}

export function ageT(commit: CommitEntry, range: AgeRange): number {
  if (range.span <= 0) return 0.5;
  const d = dateToDays(commit.date);
  return clamp01((d - range.oldest) / range.span);
}

export function sizeT(commit: CommitEntry, range: SizeRange): number {
  if (range.span <= 0) return 0.5;
  return clamp01((commit.files - range.min) / range.span);
}

/** Compute per-commit gap (days since the previous commit) plus the
 *  min/max range across the array. commits.length < 2 → all gaps are
 *  0 and the range collapses, callers will fall through to t=0.5. */
export function computeCommitGaps(commits: CommitEntry[] | null): CommitGaps {
  if (!commits || commits.length === 0) {
    return { gaps: [], range: { min: 0, max: 0, span: 0 } };
  }
  const n = commits.length;
  const gaps = new Array<number>(n).fill(0);
  if (n < 2) {
    return { gaps, range: { min: 0, max: 0, span: 0 } };
  }
  let min = Infinity;
  let max = -Infinity;
  let prevDay = dateToDays(commits[0].date);
  for (let i = 1; i < n; i++) {
    const day = dateToDays(commits[i].date);
    const gap = day - prevDay;
    const safeGap = gap < 0 ? 0 : gap;
    gaps[i] = safeGap;
    if (safeGap < min) min = safeGap;
    if (safeGap > max) max = safeGap;
    prevDay = day;
  }
  return { gaps, range: { min, max, span: max - min } };
}

/** Normalize a per-commit gap to [0, 1]. **Short gaps (rapid-fire
 *  commits) map toward t=1**; long gaps (isolated commits) map toward
 *  t=0. Logarithmic so the typical 1–30 day band stays readable when
 *  outliers stretch into the hundreds. */
export function gapT(gap: number, range: GapRange): number {
  if (range.span <= 0) return 0.5;
  const logMin = Math.log1p(range.min);
  const logMax = Math.log1p(range.max);
  const logSpan = logMax - logMin;
  if (logSpan <= 0) return 0.5;
  const t = clamp01((Math.log1p(gap) - logMin) / logSpan);
  return 1 - t;
}

/** Convenience: gap-T by commit index. Commit 0 has no previous so
 *  there's no gap signal — return 0.5 (neutral) for it. */
export function gapTByIndex(commitGaps: CommitGaps, idx: number): number {
  if (idx <= 0 || idx >= commitGaps.gaps.length) return 0.5;
  return gapT(commitGaps.gaps[idx], commitGaps.range);
}
