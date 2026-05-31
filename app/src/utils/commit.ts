// utils/commit.ts — Pure helpers for per-commit UI concerns: building
// a browseable commit URL from the scanner's normalized remote, and
// counting same-day commits for the busyness badge. Used by the commit
// pane and the coordinator.

import type { CommitEntry } from '@/types';

/**
 * Build a browseable commit URL from a normalized remote URL + full SHA.
 *
 * Uses the `/commit/{sha}` suffix that GitHub, GitLab, Bitbucket, Gitea,
 * Codeberg, and Forgejo all share. Hosts with a different convention
 * will 404, which is acceptable — the link is best-effort and the SHA
 * is always shown in plain text as the fallback.
 */
export function commitUrl(remote: string, sha: string): string | null {
  if (!remote || !sha) return null;
  const trimmed = remote.endsWith('/') ? remote.slice(0, -1) : remote;
  return `${trimmed}/commit/${sha}`;
}

/**
 * Map of `date` → number of commits on that date. Memoized per `commits`
 * array reference: building it once is O(n); subsequent calls with the
 * same array are O(1). The world replaces the array reference on every
 * manifest swap, so a fresh manifest gets a fresh map.
 */
const _perDayCache = new WeakMap<readonly CommitEntry[], Map<string, number>>();

function _perDay(commits: readonly CommitEntry[]): Map<string, number> {
  let m = _perDayCache.get(commits);
  if (m) return m;
  m = new Map<string, number>();
  for (const c of commits) m.set(c.date, (m.get(c.date) ?? 0) + 1);
  _perDayCache.set(commits, m);
  return m;
}

/** Count of commits whose date matches `commit.date` (includes `commit` itself). */
export function sameDayCommitCount(commit: CommitEntry, commits: readonly CommitEntry[]): number {
  return _perDay(commits).get(commit.date) ?? 0;
}

/**
 * Per-day commit-count thresholds derived from the repo's own activity,
 * so a day is labeled "Busy" / "Avg" / "Light" relative to that repo
 * rather than via global magic numbers — a hobby repo's busy day differs
 * from a large project's.
 *
 * - `avg`: median commits-per-day (across days with ≥ 1 commit). A day
 *   at or above this hits at least the "Avg" band.
 * - `busy`: 75th percentile (clamped to `avg + 1` so the three bands are
 *   always distinct).
 *
 * Returns `{ avg: 1, busy: 1 }` for empty input so callers don't need
 * to guard.
 */
const _thresholdsCache = new WeakMap<readonly CommitEntry[], { avg: number; busy: number }>();

export function dailyCommitThresholds(commits: readonly CommitEntry[]): { avg: number; busy: number } {
  const hit = _thresholdsCache.get(commits);
  if (hit) return hit;
  if (commits.length === 0) {
    const result = { avg: 1, busy: 1 };
    _thresholdsCache.set(commits, result);
    return result;
  }
  const counts = Array.from(_perDay(commits).values()).sort((a, b) => a - b);
  const quantile = (q: number): number => counts[Math.min(counts.length - 1, Math.floor(counts.length * q))];
  const avg = quantile(0.5);
  const busy = Math.max(quantile(0.75), avg + 1);
  const result = { avg, busy };
  _thresholdsCache.set(commits, result);
  return result;
}
