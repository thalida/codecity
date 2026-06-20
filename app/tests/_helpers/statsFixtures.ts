import type { RepoStats, FileLeader, CommitEntry, RangeStat } from '@/types';
import { EMPTY_REPO_STATS } from '@/constants/manifest';

interface TreeLike {
  type?: string;
  lines?: number;
  size?: number;
  children?: TreeLike[];
}

/** Non-zero file line/byte ranges over a fixture tree, mirroring
 *  api/services/stats.py — for bench/layout fixtures that feed layoutCity,
 *  which reads stats.fileLines/fileBytes to size buildings. Without this the
 *  layout falls back to the {1,1} safe range (every building min-width). */
export function fileStats(tree: TreeLike): Pick<RepoStats, 'fileLines' | 'fileBytes'> {
  let lMin = Infinity;
  let lMax = -Infinity;
  let bMin = Infinity;
  let bMax = -Infinity;
  const walk = (n: TreeLike) => {
    for (const c of n.children ?? []) {
      if (c.type === 'file') {
        if (c.lines && c.lines > 0) {
          lMin = Math.min(lMin, c.lines);
          lMax = Math.max(lMax, c.lines);
        }
        if (c.size && c.size > 0) {
          bMin = Math.min(bMin, c.size);
          bMax = Math.max(bMax, c.size);
        }
      } else {
        walk(c);
      }
    }
  };
  walk(tree);
  const range = (mn: number, mx: number): RangeStat =>
    mx >= mn ? { min: mn, max: mx } : { min: 0, max: 0 };
  return { fileLines: range(lMin, lMax), fileBytes: range(bMin, bMax) };
}

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
