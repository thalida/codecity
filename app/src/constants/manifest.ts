// constants/manifest.ts — Sentinel empty manifest used when no source is
// loaded (cold boot with no ?src= param, or error recovery). Shared by the
// boot / manifest-stream modules and tests that need a minimal Manifest value.

import { NodeKind } from '../types';
import type { Manifest, RepoStats } from '../types';

export const EMPTY_REPO_STATS: RepoStats = {
  fileLines: { min: 0, max: 0 },
  fileBytes: { min: 0, max: 0 },
  oldestFile: null,
  newestFile: null,
  freshestFile: null,
  stalestFile: null,
  tallestFile: null,
  shortestFile: null,
  widestFile: null,
  narrowestFile: null,
  largestMedia: null,
  sharpestMedia: null,
  mediaCount: 0,
  deepestDir: null,
  biggestDir: null,
  grandestCommit: null,
  sparsestCommit: null,
  busiestDay: null,
  longestStreakDays: 0,
  authors: [],
};

export const EMPTY_MANIFEST: Manifest = {
  root: '',
  scanned_at: new Date().toISOString(),
  signature: '',
  tree_signature: '',
  tree: {
    name: '',
    type: NodeKind.Directory,
    path: '',
    fullPath: '',
    children: [],
    children_count: 0,
    children_file_count: 0,
    children_dir_count: 0,
    descendants_count: 0,
    descendants_file_count: 0,
    descendants_dir_count: 0,
    descendants_size: 0,
    descendants_ext_breakdown: [],
  },
  repo: {
    branch: null,
    remote_url: null,
    head_sha: null,
    head_subject: null,
    dirty: false,
  },
  commits: [],
  busyness: { avg: 1, busy: 1 },
  dateRanges: { createdMin: null, createdMax: null, modifiedMin: null, modifiedMax: null },
  stats: EMPTY_REPO_STATS,
};
