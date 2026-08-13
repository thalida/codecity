// city/components/trees/treeEncoding.ts — commit metadata as [0,1] signals: age,
// size, commits per day. The ranges come from manifest.stats rather than a walk
// here, since the trees and the firefly orbits would each redo it. Every
// degenerate case (no stats, no commits, no spread) collapses to the midpoint.

import type { CommitEntry, BusynessThresholds, RepoStats } from '@/types';
import type { TreesConfig } from '@/state/stores/settings/trees';
import { recencyT } from '@/city/utils/recency';
import { epochDay } from '@/utils/dates';

export interface AgeRange {
  /** Epoch days of the oldest commit. */
  oldest: number;
  /** Epoch days of the newest commit. */
  newest: number;
  /** newest - oldest. 0 when there is no meaningful range. */
  span: number;
  /** What "now" means to every commit. Not Date.now(): a live clock would
   *  drift tree heights and break the goldens. */
  scanned: number;
}

export interface SizeRange {
  min: number;
  max: number;
  /** max - min. 0 when there is no meaningful range. */
  span: number;
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;

// Memoized: parsing is the hot cost of the decoration pass, and a date is
// re-read several times per tree and again per orb.
const _daysCache = new Map<string, number>();
// Bound the memo so many-repo sessions can't grow it without limit (a date is
// one entry; the cap spans centuries of daily commits). Clearing is safe.
const _DAYS_CACHE_MAX = 1 << 16;

/** Convert a YYYY-MM-DD string to integer epoch days. */
function dateToDays(date: string): number {
  const cached = _daysCache.get(date);
  if (cached !== undefined) return cached;
  const day = epochDay(date);
  const days = Number.isNaN(day) ? 0 : day;
  if (_daysCache.size >= _DAYS_CACHE_MAX) _daysCache.clear();
  _daysCache.set(date, days);
  return days;
}

function clamp01(t: number): number {
  if (t < 0) return 0;
  if (t > 1) return 1;
  return t;
}

/** The commit-date range and the scan date measured against it. Omitting the
 *  scan date treats the newest commit as now, so it can't look abandoned. */
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

/** The files-changed range, from the backend's leaders. Zeroes with no stats,
 *  which collapses sizeT to the midpoint. */
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

/** A day's commit count on the colour ramp, anchored on the repo's own busyness
 *  thresholds so the gradient agrees with the pane's Quiet/Average/Busy. */
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

/** The same, for a commit by index, off its baked same_day_total. */
export function dailyCountTByIndex(
  commits: CommitEntry[] | null,
  idx: number,
  thresholds: BusynessThresholds
): number {
  if (!commits || idx < 0 || idx >= commits.length) return 0.5;
  return dailyCountT(commits[idx].same_day_total, thresholds);
}

/** A tree's height, from its commit's age on the recency scale building colour
 *  uses. Shared with the firefly orbits, which would otherwise drift. */
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

/** A tree's radius, from its commit's file count, attenuated by age so a young
 *  tree isn't adult-wide. Shared with the firefly orbit radius. */
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
