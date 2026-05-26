// views/widgets/commitMetrics.ts — pure helpers for per-commit UI metrics
// used by the commit pane and (eventually) other views.

import type { CommitEntry } from '@/types';

/** Count of commits whose date matches `commit.date` (includes `commit` itself). */
export function sameDayCommitCount(commit: CommitEntry, commits: CommitEntry[]): number {
  return commits.filter((c) => c.date === commit.date).length;
}
