// scene/trees/treeEncoding.ts — pure helpers turning commit metadata
// into [0,1] normalized "age" and "size" signals. The renderer uses
// these to pick per-tree colors and heights.
//
// Robust to:
//   - null commits (non-git roots)
//   - empty commits arrays (git roots with no commits in window)
//   - all-same-date or all-same-files cases (zero-span: collapse to t=0.5)
//   - out-of-range dates (clamp to [0,1])
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
