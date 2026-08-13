import type { RepoStats, FileLeader, CommitEntry, RangeStat } from '@/types';
import { EMPTY_REPO_STATS } from '@/constants/manifest';

interface TreeLike {
  type?: string;
  lines?: number;
  size?: number;
  children?: TreeLike[];
}

/** The line and byte ranges layoutCity sizes buildings against, mirroring the
 *  backend: without them every building comes out min-width. */
export function fileStats(tree: TreeLike): Pick<RepoStats, 'lineCountRange' | 'byteSizeRange'> {
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
  return { lineCountRange: range(lMin, lMax), byteSizeRange: range(bMin, bMax) };
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

// Not a mirror of the backend's hue function: nothing here reads a hue it
// didn't get from below. Frozen, because a golden digests the orb colours.
function authorHue(name: string): number {
  let h = 0x811c9dc5 >>> 0;
  for (const byte of new TextEncoder().encode(name)) {
    h ^= byte;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % 360;
}

/** The commit-derived stats the trees and fireflies read, so a test can declare
 *  a few commits instead of a whole RepoStats. */
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
    .map(([name, n]) => ({ name, commits: n, hue: authorHue(name) }))
    .sort((a, b) => b.commits - a.commits || a.name.localeCompare(b.name));
  return {
    ...EMPTY_REPO_STATS,
    commitDates: { oldest, newest },
    maxFilesPerCommit: { sha: grandest.sha, files: grandest.files, date: grandest.date },
    minFilesPerCommit: { sha: sparsest.sha, files: sparsest.files, date: sparsest.date },
    authors,
  };
}

/** A RepoStats where every file superlative points at one file — for tests
 *  that only need "the buildings section renders for this file". */
export function uniformFileStats(path: string, lines: number, bytes: number): RepoStats {
  const l = fileLeader(path, lines, bytes);
  return {
    ...EMPTY_REPO_STATS,
    totalLines: lines,
    codeBytes: bytes,
    oldestCreatedFile: l,
    newestCreatedFile: l,
    newestModifiedFile: l,
    oldestModifiedFile: l,
    maxLinesFile: l,
    minLinesFile: l,
    maxBytesFile: l,
    minBytesFile: l,
  };
}
