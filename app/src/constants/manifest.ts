// constants/manifest.ts — Sentinel empty manifest used when no source is
// loaded (cold boot with no ?src= param, or error recovery). Shared by the
// boot / manifest-stream modules and tests that need a minimal Manifest value.

import { NodeKind } from '../types';
import type { Manifest, RepoStats } from '../types';

// The root's path. Every node path is repo-relative, and this is the one root
// representation, so comparing against it reliably means "this is the root".
export const ROOT_PATH = '.';

export const EMPTY_REPO_STATS: RepoStats = {
  lineCountRange: { min: 0, max: 0 },
  byteSizeRange: { min: 0, max: 0 },
  oldestCreatedFile: null,
  newestCreatedFile: null,
  newestModifiedFile: null,
  oldestModifiedFile: null,
  maxLinesFile: null,
  minLinesFile: null,
  maxBytesFile: null,
  minBytesFile: null,
  maxMediaBytesFile: null,
  minMediaBytesFile: null,
  maxMediaPixelsFile: null,
  minMediaPixelsFile: null,
  maxBinaryBytesFile: null,
  minBinaryBytesFile: null,
  mediaCount: 0,
  binaryCount: 0,
  totalLines: 0,
  dirtyFileCount: 0,
  codeBytes: 0,
  maxDepthDir: null,
  maxChildrenDir: null,
  minChildrenDir: null,
  oldestCommit: null,
  newestCommit: null,
  oldestCreatedDir: null,
  newestCreatedDir: null,
  maxFilesPerCommit: null,
  minFilesPerCommit: null,
  commitCount: 0,
  commitDates: { oldest: null, newest: null },
  maxCommitsPerDay: null,
  maxCommitStreakDays: 0,
  authors: [],
};

export const EMPTY_MANIFEST: Manifest = {
  root: '',
  // Nothing scanned yet, so every stage is still outstanding.
  pending: ['metadata', 'history'],
  readmePath: null,
  readmeModified: null,
  scanned_at: new Date().toISOString(),
  content_signature: '',
  structure_signature: '',
  layout_signature: '',
  tree: {
    name: '',
    type: NodeKind.Directory,
    path: ROOT_PATH,
    fullPath: '',
    children: [],
    children_count: 0,
    children_file_count: 0,
    children_dir_count: 0,
    descendants_count: 0,
    descendants_file_count: 0,
    descendants_dir_count: 0,
    descendants_size: 0,
    descendants_created_min: null,
    descendants_modified_max: null,
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
  dateRanges: { minCreated: null, maxCreated: null, minModified: null, maxModified: null },
  stats: EMPTY_REPO_STATS,
};
