// city/components/trees/treeEncoding.ts — pure helpers turning commit metadata
// into [0,1] normalized signals (age / size / commits-per-day). The
// renderer uses these to pick per-tree heights, widths, and colors.
//
// The project-wide age + size RANGES are read from manifest.stats (computed
// once on the backend) rather than re-scanned here — the trees and the
// firefly orbits both consume them, so a client-side walk would duplicate
// the backend's work twice per rebuild. The per-commit signals (ageT/sizeT)
// still take a single commit + the precomputed range.
//
// Robust to:
//   - absent stats / null commits (non-git roots)
//   - empty commit history (git roots with no commits in window)
//   - degenerate ranges (all-same-date / -files / -counts → collapse to t=0.5)
//   - out-of-range inputs (clamp to [0,1])
//
// Date math is day-precision because the scanner emits YYYY-MM-DD.

import type { CommitEntry, BusynessThresholds, RepoStats } from '@/types';
import type { TreesConfig } from '@/state/stores/settings/trees';
import { recencyT } from '@/city/utils/recency';

export interface AgeRange {
  /** Epoch days of the oldest commit. */
  oldest: number;
  /** Epoch days of the newest commit. */
  newest: number;
  /** newest - oldest. 0 when there is no meaningful range. */
  span: number;
  /** Epoch day the repo was scanned, i.e. what "now" means to every commit
   *  here. Falls back to `newest` when scanned_at wasn't supplied, so an
   *  unknown scan date can't age the forest. Deliberately not Date.now(): a
   *  live clock would drift tree height and break the goldens. */
  scanned: number;
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
// Bound the memo so many-repo sessions can't grow it without limit (a date is
// one entry; the cap spans centuries of daily commits). Clearing is safe.
const _DAYS_CACHE_MAX = 1 << 16;

/** Convert a YYYY-MM-DD string to integer epoch days. */
function dateToDays(date: string): number {
  const cached = _daysCache.get(date);
  if (cached !== undefined) return cached;
  const ms = Date.parse(date);
  const days = Number.isNaN(ms) ? 0 : Math.floor(ms / MS_PER_DAY);
  if (_daysCache.size >= _DAYS_CACHE_MAX) _daysCache.clear();
  _daysCache.set(date, days);
  return days;
}

function clamp01(t: number): number {
  if (t < 0) return 0;
  if (t > 1) return 1;
  return t;
}

/** Oldest/newest commit dates as epoch days, from the backend-computed
 *  stats.commitDates, plus the scan date every commit is measured against.
 *  All zeroes when stats are absent or the repo has no commits (commitDates
 *  null) — collapses ageT to the 0.5 midpoint.
 *
 *  `scannedAt` is the manifest's `scanned_at` (any Date.parse-able string; day
 *  precision). Omitting it treats the newest commit as now, so a missing scan
 *  date can't make the forest look abandoned. */
export function computeAgeRange(
  stats: RepoStats | null | undefined,
  scannedAt?: string | null
): AgeRange {
  const cd = stats?.commitDates;
  if (!cd || cd.oldest === null || cd.newest === null) {
    return { oldest: 0, newest: 0, span: 0, scanned: 0 };
  }
  const oldest = dateToDays(cd.oldest);
  const newest = dateToDays(cd.newest);
  const scanned = scannedAt == null ? newest : Math.max(newest, dateToDays(scannedAt));
  return { oldest, newest, span: newest - oldest, scanned };
}

/** Min/max files-changed across commits, from the backend-computed
 *  sparsest/grandest commit leaders. {0,0,0} when stats are absent or the
 *  repo has no commits (leaders null) — collapses sizeT to the 0.5 midpoint. */
export function computeSizeRange(stats: RepoStats | null | undefined): SizeRange {
  const min = stats?.minFilesPerCommit?.files ?? 0;
  const max = stats?.maxFilesPerCommit?.files ?? 0;
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
 *  Older commits grow taller, from real age via city/utils/recency, the same
 *  scale building colour uses: maturity = 1 − recency. A repo abandoned years
 *  ago is a tall forest throughout, with no separate staleness rule. A
 *  null/missing commit has no date and collapses to the midpoint.
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
  const maturity = 1 - commitRecency(commit, ageRange, cfg);
  return minHeight + maturity * (maxHeight - minHeight);
}

/** Epoch days here (the scanner emits YYYY-MM-DD), converted on the way into
 *  the shared scale. */
function commitRecency(commit: CommitEntry, ageRange: AgeRange, cfg: TreesConfig): number {
  return recencyT(
    dateToDays(commit.date) * MS_PER_DAY,
    ageRange.scanned * MS_PER_DAY,
    cfg.HALF_LIFE_DAYS
  );
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
