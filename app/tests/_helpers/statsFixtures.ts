import type { RepoStats, FileLeader } from '@/types';
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
