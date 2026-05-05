// types/manifest.ts — shape of the Python scanner's output, consumed by
// the scene + views. Pairs with no config file (manifest is input data,
// not a tunable).

/**
 * Single shared discriminator across scene + selection state. Mirrors the
 * 'type' field the scanner stamps on each tree node. GEM and LABEL are
 * scene-only concepts (never appear on a manifest node) but live here
 * because the renderer's mesh.userData.type uses the same union.
 */
export enum NodeKind {
  File = 'file',
  Directory = 'directory',
  Gem = 'gem',
  Label = 'label',
}

/** Git metadata for a file. ISO 8601 timestamps; null if untracked. */
export interface GitMeta {
  created: string | null;
  modified: string | null;
}

export interface FileNode {
  name: string;
  type: NodeKind.File;
  path: string;
  fullPath: string;
  extension: string;
  size: number;
  lines: number;
  binary: boolean;
  created: string;
  modified: string;
  git: GitMeta | null;
}

export interface DirNode {
  name: string;
  type: NodeKind.Directory;
  path: string;
  fullPath: string;
  children: TreeNode[];
  children_count: number;
  children_file_count: number;
  children_dir_count: number;
  descendants_count: number;
  descendants_file_count: number;
  descendants_dir_count: number;
  descendants_size: number;
}

export type TreeNode = FileNode | DirNode;

/**
 * Repo-level git metadata surfaced in the footer (branch, remote link,
 * dirty marker, last commit). All fields nullable because a fresh repo
 * with no commits yet has no HEAD; a repo with no remote has no URL.
 * `null` for non-git roots — see `Manifest.repo`.
 */
export interface RepoInfo {
  branch: string | null;
  remote_url: string | null;
  head_sha: string | null;
  head_subject: string | null;
  dirty: boolean;
}

export interface Manifest {
  root: string;
  scanned_at: string;
  signature: string;
  tree: DirNode;
  repo: RepoInfo | null;
}

/**
 * Min/max date strings (ISO 8601) for created + modified across every
 * file in the manifest. Used by the building-color HSL ramps so the
 * oldest file lands at min lightness/saturation, newest at max.
 */
export interface DateRanges {
  createdMin: string | null;
  createdMax: string | null;
  modifiedMin: string | null;
  modifiedMax: string | null;
}

/** Min/max numeric range for file stats (line counts, byte sizes). */
export interface RangeStat {
  min: number;
  max: number;
}

/** Project-wide stats for buildings to normalize against. */
export interface FileStats {
  lines: RangeStat;
  bytes: RangeStat;
}
