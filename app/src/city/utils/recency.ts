// How recent a dated thing is, on one scale shared by building colour and tree
// maturity.
//
// Two signals, because either alone lies. Rank within the repo says nothing
// about whether the repo is alive: a project untouched since 2019 still has a
// "newest" file sitting at full freshness. Wall-clock age alone throws away the
// spread that makes a city readable, since a repo written in one week collapses
// to a single value. So both are computed and mixed.
//
// The mix also decides how much a single commit disturbs everything else. Rank
// is relative, so one edit moves the range and restates every other item; the
// absolute half is immune, and the weight is how much of that lurch survives.

const DAY_MS = 86_400_000;

/** Oldest and newest observed timestamps, in ms. */
export interface RecencyRange {
  min: number;
  max: number;
}

export interface RecencyConfig {
  /** Days at which a date bottoms out as old. */
  horizonDays: number;
  /** 1 = rank within the repo alone, 0 = wall-clock alone. */
  relativeWeight: number;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** 1 = dated at `nowMs`, 0 = at or beyond the horizon. Horizon is floored at a
 *  day so a mis-set 0 can't divide by zero. */
export function absoluteRecency(dateMs: number, nowMs: number, horizonDays: number): number {
  return clamp01(1 - (nowMs - dateMs) / (Math.max(1, horizonDays) * DAY_MS));
}

/** 1 = newest in the repo, 0 = oldest. A repo whose dates all coincide reads
 *  freshest, which is what Live does rather than divide by zero. */
export function relativeRecency(dateMs: number, range: RecencyRange): number {
  const span = range.max - range.min;
  if (!(span > 0)) return 1;
  return clamp01((dateMs - range.min) / span);
}

/**
 * The blended signal: 1 is freshest, 0 is oldest.
 *
 * `nowMs` is the moment being measured against — scan time in Live, and the
 * commit under the scrubber in Timeline, so a city scrubbed to its first commit
 * reads new rather than uniformly ancient.
 *
 * An unparseable date has no position on either scale, so it takes the midpoint
 * instead of pretending to be new or old.
 */
export function recencyT(
  dateMs: number,
  nowMs: number,
  range: RecencyRange,
  cfg: RecencyConfig
): number {
  if (!Number.isFinite(dateMs)) return 0.5;
  const absolute = absoluteRecency(dateMs, nowMs, cfg.horizonDays);
  const relative = relativeRecency(dateMs, range);
  return absolute + (relative - absolute) * clamp01(cfg.relativeWeight);
}
