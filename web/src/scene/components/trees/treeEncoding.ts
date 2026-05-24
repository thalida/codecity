// scene/trees/treeEncoding.ts — pure helpers turning commit metadata
// into [0,1] normalized signals (age / size / commits-per-day). The
// renderer uses these to pick per-tree heights, widths, and colors.
//
// Robust to:
//   - null commits (non-git roots)
//   - empty commits arrays (git roots with no commits in window)
//   - degenerate ranges (all-same-date / -files / -counts → collapse to t=0.5)
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

export interface DailyCountRange {
  /** Smallest per-day commit count across the history (>=1 for non-empty input). */
  min: number;
  /** Largest per-day commit count across the history. */
  max: number;
  /** max - min. 0 when there is no meaningful range. */
  span: number;
}

export interface DailyCounts {
  /** Per-commit count of commits sharing that commit's calendar date.
   *  Same length as the input commits array; counts[i] = N when commit i
   *  shares its date with N-1 other commits (so counts[i] >= 1 for any
   *  valid commit). */
  counts: number[];
  range: DailyCountRange;
}

/** Group commits by `date` (YYYY-MM-DD) and assign each commit the size
 *  of its day-group. Single O(n) pass: first pass tallies dates into a
 *  Map, second pass writes per-commit counts. Min/max are taken across
 *  the per-commit counts. */
export function computeDailyCounts(commits: CommitEntry[] | null): DailyCounts {
  if (!commits || commits.length === 0) {
    return { counts: [], range: { min: 0, max: 0, span: 0 } };
  }
  const byDate = new Map<string, number>();
  for (let i = 0; i < commits.length; i++) {
    const d = commits[i].date;
    byDate.set(d, (byDate.get(d) ?? 0) + 1);
  }
  const counts = new Array<number>(commits.length);
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < commits.length; i++) {
    const c = byDate.get(commits[i].date) ?? 0;
    counts[i] = c;
    if (c < min) min = c;
    if (c > max) max = c;
  }
  return { counts, range: { min, max, span: max - min } };
}

/** Normalize a per-day commit count to [0, 1]. **High counts (busy days)
 *  map toward t=1**; low counts (solo-commit days) map toward t=0.
 *  Logarithmic so the typical 1–10 commits-per-day band stays readable
 *  when one outlier day hits 50+ commits. */
export function dailyCountT(count: number, range: DailyCountRange): number {
  if (range.span <= 0) return 0.5;
  const logMin = Math.log1p(range.min);
  const logMax = Math.log1p(range.max);
  const logSpan = logMax - logMin;
  if (logSpan <= 0) return 0.5;
  return clamp01((Math.log1p(count) - logMin) / logSpan);
}

/** Convenience: daily-count-T by commit index. Out-of-range indices
 *  return 0.5 (neutral) — every in-range commit has a valid count, so
 *  there's no "index 0 is special" case here. */
export function dailyCountTByIndex(dc: DailyCounts, idx: number): number {
  if (idx < 0 || idx >= dc.counts.length) return 0.5;
  return dailyCountT(dc.counts[idx], dc.range);
}
