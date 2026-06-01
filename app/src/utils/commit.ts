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

// Per-day commit-count thresholds (the "Busy/Average/Quiet" bands) are now
// computed once on the backend and read from manifest.busyness — see
// api/scan.py _compute_busyness + the BusynessThresholds type.
