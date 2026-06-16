// city/components/trees/treeEncoding.ts — pure helpers turning commit metadata
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
import type { TreesConfig } from '@/state/stores/settings/trees';

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

// Memoized by date string. Date.parse is the hot cost in the decoration pass —
// ageT/treeHeight/treeRadius re-parse a commit's date several times per tree
// (and again per firefly orb), but only ~one distinct date per day exists.
const _daysCache = new Map<string, number>();

/** Convert a YYYY-MM-DD string to integer epoch days. */
function dateToDays(date: string): number {
  const cached = _daysCache.get(date);
  if (cached !== undefined) return cached;
  const ms = Date.parse(date);
  const days = Number.isNaN(ms) ? 0 : Math.floor(ms / MS_PER_DAY);
  _daysCache.set(date, days);
  return days;
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

/** Canopy height for a tree.
 *
 *  HEIGHT is driven by AGE: older commits grow taller. ageT=0 (oldest)
 *  → MAX_HEIGHT; ageT=1 (newest) → MIN_HEIGHT. A null/missing commit
 *  collapses to the midpoint.
 *
 *  Single source of truth for the tree renderer's canopy/trunk height
 *  AND the firefly orbit height — both must derive from the identical
 *  formula so fireflies never drift off their trees. */
export function treeHeight(
  commit: CommitEntry | null | undefined,
  ageRange: AgeRange,
  cfg: TreesConfig
): number {
  const minHeight = cfg.MIN_HEIGHT;
  const maxHeight = cfg.MAX_HEIGHT;
  if (!commit) return (minHeight + maxHeight) * 0.5;
  const t = ageT(commit, ageRange);
  return maxHeight - t * (maxHeight - minHeight);
}

/** Canopy XZ radius for a tree.
 *
 *  WIDTH is driven by FILES (sizeT): more files = wider. Attenuated by
 *  AGE via WIDTH_AGE_FLOOR so short young trees don't render adult-wide
 *  (floor=1.0 disables the attenuation, byte-identical to pre-feature
 *  rendering). A null/missing commit uses the midpoint base radius.
 *
 *  Single source of truth shared by the tree renderer (canopy/trunk
 *  width) and the firefly orbit radius. */
export function treeRadius(
  commit: CommitEntry | null | undefined,
  ageRange: AgeRange,
  sizeRange: SizeRange,
  cfg: TreesConfig
): number {
  const minHeight = cfg.MIN_HEIGHT;
  const maxHeight = cfg.MAX_HEIGHT;
  const minRadius = cfg.MIN_WIDTH / 2;
  const maxRadius = cfg.MAX_WIDTH / 2;

  let baseRadius: number;
  if (commit) {
    const t = sizeT(commit, sizeRange);
    baseRadius = minRadius + t * (maxRadius - minRadius);
  } else {
    baseRadius = (minRadius + maxRadius) * 0.5;
  }
  // Clamp height range to avoid divide-by-zero when min == max.
  const heightRange = Math.max(0.001, maxHeight - minHeight);
  const heightRatio = (treeHeight(commit, ageRange, cfg) - minHeight) / heightRange;
  const floor = Math.max(0, Math.min(1, cfg.WIDTH_AGE_FLOOR));
  const ageAttenuation = floor + (1 - floor) * heightRatio;
  return baseRadius * ageAttenuation;
}
