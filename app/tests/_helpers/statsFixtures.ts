import type { RepoStats, FileLeader, CommitEntry } from '@/types';
import { EMPTY_REPO_STATS } from '@/constants/manifest';

export function fileLeader(
  path: string,
  lines: number,
  bytes: number,
  created = '2020-01-01T00:00:00Z',
  modified = '2020-01-01T00:00:00Z'
): FileLeader {
  return { path, lines, bytes, created, modified };
}

/** Build the commit-derived RepoStats fields the tree renderer + firefly field
 *  read (commitDates, sparsest/grandest commit, authors), mirroring
 *  api/services/stats.py. Lets the rendering tests build terse commit fixtures
 *  and derive the stats the components now consume — exactly as the trees /
 *  fireflies components pass manifest.stats. The backend's test_stats.py owns
 *  extraction correctness; this only reproduces it for fixtures. */
export function commitStats(commits: CommitEntry[]): RepoStats {
  if (commits.length === 0) return EMPTY_REPO_STATS;
  let oldest = commits[0].date;
  let newest = commits[0].date;
  let grandest = commits[0];
  let sparsest = commits[0];
  const counts = new Map<string, number>();
  for (const c of commits) {
    if (c.date < oldest) oldest = c.date;
    if (c.date > newest) newest = c.date;
    if (c.files > grandest.files) grandest = c;
    if (c.files < sparsest.files) sparsest = c;
    for (const a of c.authors) counts.set(a, (counts.get(a) ?? 0) + 1);
  }
  const authors = [...counts.entries()]
    .map(([name, n]) => ({ name, commits: n }))
    .sort((a, b) => b.commits - a.commits || a.name.localeCompare(b.name));
  return {
    ...EMPTY_REPO_STATS,
    commitDates: { oldest, newest },
    grandestCommit: { sha: grandest.sha, files: grandest.files },
    sparsestCommit: { sha: sparsest.sha, files: sparsest.files },
    authors,
  };
}

/** A RepoStats where every file superlative points at one file — for tests
 *  that only need "the buildings section renders for this file". */
export function uniformFileStats(path: string, lines: number, bytes: number): RepoStats {
  const l = fileLeader(path, lines, bytes);
  return {
    ...EMPTY_REPO_STATS,
    oldestFile: l,
    newestFile: l,
    freshestFile: l,
    stalestFile: l,
    tallestFile: l,
    shortestFile: l,
    widestFile: l,
    narrowestFile: l,
  };
}
