// utils/emptyManifest.ts — Sentinel empty manifest used when no source is
// loaded (cold boot with no ?src= param, or error recovery). Shared by
// boot.ts / appLogic.ts and tests that need a minimal Manifest value.

import { NodeKind } from '../types';
import type { Manifest } from '../types';

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
  },
  repo: {
    branch: null,
    remote_url: null,
    head_sha: null,
    head_subject: null,
    dirty: false,
  },
  commits: [],
};
