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

export interface FileNode {
  name: string;
  type: NodeKind.File;
  path: string;
  fullPath: string;
  extension: string;
  size: number;
  lines: number;
  binary: boolean;
  /** Working-tree differs from HEAD for this tracked file (staged or
   *  unstaged). Always false for clean/remote repos. */
  dirty: boolean;
  /** ISO create date, resolved server-side: git history date when the
   *  file has one, filesystem date otherwise (e.g. staged-but-uncommitted). */
  created: string;
  /** ISO modify date, resolved server-side: git history date when the
   *  file has one, filesystem date otherwise (e.g. staged-but-uncommitted).
   *  When dirty is true, this is always the working-tree filesystem date,
   *  regardless of git history. */
  modified: string;
  /**
   * Media classification by extension, computed by the backend (single
   * source of truth — the frontend no longer hand-lists extensions). null
   * for non-media files. See api/services/media.py:media_kind and
   * city/utils/mediaKind.ts.
   */
  mediaKind?: 'image' | 'video' | null;
  /**
   * Optional pixel dimensions for recognized media files (png/jpg/svg/
   * mp4/etc.). Either both keys appear together or neither does. Layout
   * uses these to size the building's silhouette; absence triggers a
   * 1:1 aspect fallback. Stamped by the Python scanner via
   * api/media.py.
   */
  media_width?: number;
  media_height?: number;
  /**
   * Friendly magic-byte type for binary files ("SQLite database",
   * "WebAssembly module"); absent for non-binary or unrecognized files.
   * Media files never carry it (they render as billboards, not data
   * buildings). See api/services/binfmt.py:detect_binary_type.
   */
  binaryType?: string;
}

/**
 * One file-extension bucket in a directory's descendant breakdown. `ext` is
 * the lowercase extension (".ts"), or null for extensionless files.
 * Computed once on the backend during the tree walk (see api/scan.py); the
 * street view reads it instead of re-walking the subtree on each selection.
 */
export interface ExtBreakdownEntry {
  ext: string | null;
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
  /** Oldest created / newest modified date (ISO) over all descendant files.
   *  Both null for a directory with no files. Computed once on the backend
   *  (api/services/scan.py) so the street view reads it instead of walking. */
  descendants_created_min: string | null;
  descendants_modified_max: string | null;
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
  /** Number of commits sharing this commit's calendar date (≥ 1, includes
   *  self). Baked by the backend at manifest-wrap so the commit pane's
   *  busyness badge and the scene tree-color read one consistent value. */
  same_day_total: number;
}

/**
 * Three signature fields form a ladder, each a superset of the one before:
 *  - structure_signature: paths and nesting only. Drives icon-atlas
 *    assignment and skeleton/final render stability.
 *  - layout_signature: structure, plus per-file size. Gates layout reuse,
 *    skipping the expensive re-pack when only unrelated metadata changed.
 *  - content_signature: structure, plus size, mtime, dirty, and repo HEAD.
 *    The full change-detection fingerprint: drives the live-update poll
 *    and is the manifest cache key.
 */
export interface Manifest {
  root: string;
  scanned_at: string;
  /** Full change-detection fingerprint (structure + size + mtime + dirty +
   *  repo HEAD). Changes between skeleton and final events for the same
   *  scan. Used by live-update polls to detect when any file has changed
   *  on disk, and as the manifest cache key. */
  content_signature: string;
  /** Structure-only fingerprint (paths + nesting, NO mtime/size/metadata).
   *  Identical for skeleton and final manifests of the same scan. Gates the
   *  icon atlas rebuild and skeleton/final stability checks; the layout
   *  reuse decision uses layout_signature instead. */
  structure_signature: string;
  /** Structure + per-file byte size fingerprint (the layout packer's inputs:
   *  footprints + street length). Between structure_signature (too coarse)
   *  and content_signature (too fine, includes mtime). This is the
   *  layout-reuse cache key: the reuse gate compares a fresh manifest's
   *  value against the committed one, and skips the expensive re-pack when
   *  they match. */
  layout_signature: string;
  tree: DirNode;
  repo: RepoInfo;
  /** Per-commit metadata, oldest-first. `[]` when the repo has zero
   *  commits. */
  commits: CommitEntry[];
  /** Repo-relative per-day commit-count thresholds, computed on the backend.
   *  Both the scene tree-color gradient and the commit pane's busyness label
   *  read these so they agree. */
  busyness: BusynessThresholds;
  /** Repo-wide min/max of the resolved per-file created/modified dates,
   *  computed on the backend during the scan (api/services/scan.py). */
  dateRanges: DateRanges;
  /** Repo-wide statistics (leaders, ranges, author list). Computed by the
   *  backend during the scan (api/services/stats.py). */
  stats: RepoStats;
}

/**
 * Per-day commit-count thresholds (commits/day). A day with >= busy commits
 * reads as "Busy", >= avg as "Average", else "Quiet". `avg` is the median
 * commits/day; `busy` is the 75th percentile (clamped to avg+1). Computed
 * once on the backend (see api/scan.py) from the commit history.
 */
export interface BusynessThresholds {
  avg: number;
  busy: number;
}

/**
 * Min/max date strings (ISO 8601) for created + modified across every
 * file in the manifest, computed on the backend during the scan
 * (api/services/scan.py). All dates on the wire are UTC Z-suffixed in
 * one fixed format, so the backend's lexical min/max is exact
 * chronological order. All four null for an empty tree. Used by the
 * building-color HSL ramps so the oldest file lands at min
 * lightness/saturation, newest at max.
 */
export interface DateRanges {
  minCreated: string | null;
  maxCreated: string | null;
  minModified: string | null;
  maxModified: string | null;
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

export interface FileLeader {
  path: string;
  lines: number;
  bytes: number;
  created: string;
  modified: string;
  media_width?: number;
  media_height?: number;
}

export interface DirLeader {
  path: string;
  depth: number;
  /** Direct children (files + sub-dirs on that street). */
  children: number;
  /** Everything below it, recursively. */
  descendants: number;
}

export interface CommitLeader {
  sha: string;
  files: number;
}

/**
 * Oldest/newest commit date (YYYY-MM-DD) across the lookback window — the
 * scene's tree-age normalization range, computed on the backend so the trees
 * + firefly orbits read it instead of re-scanning commits. Both null for a
 * repo with no commits.
 */
export interface CommitDateRange {
  oldest: string | null;
  newest: string | null;
}

export interface DayLeader {
  date: string;
  count: number;
}

export interface AuthorStat {
  name: string;
  commits: number;
}

export interface RepoStats {
  /** Building-size normalization ranges (non-zero), NOT honest min/max file
   *  size — 0-length files are excluded (they have no meaningful building
   *  size; the layout's log/sqrt can't take 0). The honest smallest file is in
   *  minBytesFile / minLinesFile. {0,0} when no non-zero files exist. */
  lineCountRange: RangeStat;
  byteSizeRange: RangeStat;
  oldestCreatedFile: FileLeader | null;
  newestCreatedFile: FileLeader | null;
  newestModifiedFile: FileLeader | null;
  oldestModifiedFile: FileLeader | null;
  maxLinesFile: FileLeader | null;
  minLinesFile: FileLeader | null;
  maxBytesFile: FileLeader | null;
  minBytesFile: FileLeader | null;
  maxMediaBytesFile: FileLeader | null;
  minMediaBytesFile: FileLeader | null;
  maxMediaPixelsFile: FileLeader | null;
  minMediaPixelsFile: FileLeader | null;
  /** Largest / smallest binary ("data") file by bytes. Binaries are their own
   *  category, excluded from the code superlatives above (a giant .db never
   *  wins "widest building"). null when the repo has no binary files. */
  maxBinaryBytesFile: FileLeader | null;
  minBinaryBytesFile: FileLeader | null;
  mediaCount: number;
  /** Count of binary ("data") files, excluded from the code-building count. */
  binaryCount: number;
  /** Sum of lines over code files only (non-media, non-binary). */
  totalLines: number;
  /** Count of file nodes with dirty === true (media included). */
  dirtyFileCount: number;
  /** Sum of bytes over code files only (non-media, non-binary). */
  codeBytes: number;
  maxDepthDir: DirLeader | null;
  maxChildrenDir: DirLeader | null;
  minChildrenDir: DirLeader | null;
  maxFilesPerCommit: CommitLeader | null;
  minFilesPerCommit: CommitLeader | null;
  commitDates: CommitDateRange;
  maxCommitsPerDay: DayLeader | null;
  maxCommitStreakDays: number;
  authors: AuthorStat[];
}
