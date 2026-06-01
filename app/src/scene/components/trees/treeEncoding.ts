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

import type { CommitEntry, BusynessThresholds } from '@/types';

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

/**
 * Map a per-day commit count to the tree-color ramp t in [0, 1], anchored on
 * the repo's busyness thresholds so the gradient agrees with the commit
 * pane's Quiet / Average / Busy label at the band boundaries:
 *   count <= 1 (solo-commit day) → 0   (solo-day color)
 *   count === avg (median)       → 0.5 (gradient midpoint)
 *   count >= busy (75th pct)     → 1   (busy-day color)
 * Piecewise-linear between the anchors — a smooth gradient, not flat tiers.
 */
export function dailyCountT(count: number, thresholds: BusynessThresholds): number {
  const { avg, busy } = thresholds;
  if (count <= 1) return 0;
  if (count >= busy) return 1;
  if (count <= avg) {
    // [1, avg] → [0, 0.5]
    return avg <= 1 ? 0.5 : clamp01((0.5 * (count - 1)) / (avg - 1));
  }
  // (avg, busy) → (0.5, 1]
  return busy <= avg ? 1 : clamp01(0.5 + (0.5 * (count - avg)) / (busy - avg));
}

/** Convenience: daily-count-T for the commit at `idx`, reading the
 *  backend-baked same_day_total and anchoring on the repo's busyness
 *  thresholds. Out-of-range indices (or null commits) return 0.5 (neutral). */
export function dailyCountTByIndex(
  commits: CommitEntry[] | null,
  idx: number,
  thresholds: BusynessThresholds
): number {
  if (!commits || idx < 0 || idx >= commits.length) return 0.5;
  return dailyCountT(commits[idx].same_day_total, thresholds);
}
