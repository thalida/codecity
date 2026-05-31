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
  Commit = 'commit',
}

/**
 * Git metadata for a file. ISO 8601 timestamps; null when the scanner
 * never observed a create/modify date for the file (e.g. uncommitted).
 */
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
  git: GitMeta;
  /**
   * Optional pixel dimensions for recognized media files (png/jpg/svg/
   * mp4/etc.). Either both keys appear together or neither does. Layout
   * uses these to size the building's silhouette; absence triggers a
   * 1:1 aspect fallback. Stamped by the Python scanner via
   * api/media.py.
   */
  media_width?: number;
  media_height?: number;
}

/**
 * One file-extension bucket in a directory's descendant breakdown. `ext` is
 * the lowercase extension (".ts") or "(none)" for extensionless files.
 * Computed once on the backend during the tree walk (see api/scan.py); the
 * street view reads it instead of re-walking the subtree on each selection.
 */
export interface ExtBreakdownEntry {
  ext: string;
  count: number;
  size: number;
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
  /** Per-extension counts/sizes over all descendant files, sorted by count
   *  desc (ext asc tiebreak). Empty for directories with no files. */
  descendants_ext_breakdown: ExtBreakdownEntry[];
}

export type TreeNode = FileNode | DirNode;

/**
 * Repo-level git metadata surfaced in the footer (branch, remote link,
 * dirty marker, last commit). All fields nullable because a fresh repo
 * with no commits yet has no HEAD; a repo with no remote has no URL.
 */
export interface RepoInfo {
  branch: string | null;
  remote_url: string | null;
  head_sha: string | null;
  head_subject: string | null;
  dirty: boolean;
}

/**
 * One commit within the git lookback window. Emitted by the scanner
 * in oldest-first order so `commits[i]` maps to the i-th-closest tree
 * placement (the chronological-outward planting order). `date` is
 * day-precision (`YYYY-MM-DD`) — sufficient for the age signal, keeps
 * payload small. `files` = count of changed paths in the commit
 * (`A/M/D/T/U` rows from `git log --name-status`). `authors` is the
 * deduped list of distinct contributors — primary (`%an`) at index 0,
 * `Co-authored-by:` trailer names following. Emails stripped (privacy).
 * `subject` is `%s` (first line of the commit message). Full message
 * body is fetched lazily via `/api/commit?sha=…`.
 */
export interface CommitEntry {
  date: string; // "YYYY-MM-DD"
  files: number;
  /** Full 40-char lowercase hex SHA. UI displays the first 7. */
  sha: string;
  /** Authors of this commit, primary first. Always length ≥ 1. */
  authors: string[];
  /** First line of the commit message. */
  subject: string;
}

export interface Manifest {
  root: string;
  /** Friendly label for the source root, set by the server for git URL
   *  sources (e.g. "https://github.com/foo/bar@main"). Absent for
   *  local-path sources. Prefer this over `root` when building UI labels. */
  display_root?: string;
  scanned_at: string;
  /** Metadata-sensitive fingerprint (mtime/size based). Changes between
   *  skeleton and final events for the same scan. Used by live-update polls
   *  to detect when any file has changed on disk. */
  signature: string;
  /** Structure-only fingerprint (paths + nesting, NO mtime/size/metadata).
   *  Identical for skeleton and final manifests of the same scan.
   *  Used as the layout-cache key in world so the expensive layout
   *  computation is skipped on skeleton→final transitions when the tree
   *  shape hasn't changed. */
  tree_signature: string;
  tree: DirNode;
  repo: RepoInfo;
  /** Per-commit metadata, oldest-first. `[]` when the repo has zero
   *  commits. */
  commits: CommitEntry[];
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
