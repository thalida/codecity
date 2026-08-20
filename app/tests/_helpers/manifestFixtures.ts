// A structurally valid but empty Manifest, for tests that need the shape rather
// than the data. Not production state: "nothing loaded" there is a null MANIFEST.

import { NodeKind } from '@/types';
import type { Manifest, RepoStats, SourceRef } from '@/types';
import { ROOT_PATH } from '@/constants/manifest';

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

/** The source an EMPTY_MANIFEST names, for tests that read a file out of one. */
export const TEST_SOURCE: SourceRef = { src: '/repo', branch: null };

export const EMPTY_MANIFEST: Manifest = {
  src: '',
  branch: null,
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
