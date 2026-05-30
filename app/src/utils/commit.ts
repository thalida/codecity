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

/** Count of commits whose date matches `commit.date` (includes `commit` itself). */
export function sameDayCommitCount(commit: CommitEntry, commits: CommitEntry[]): number {
  return commits.filter((c) => c.date === commit.date).length;
}
