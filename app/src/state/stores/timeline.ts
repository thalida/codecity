// state/stores/timeline.ts — the history ONE project is being looked at
// through: the mode, the loaded bundle, the scrub position, and everything that
// position implies. Derived reads live beside the position they read because
// resetting the mode moves it, so splitting them would make the two files cyclic.

import { signal, batch, computed, effect, type ReadonlySignal, type Signal } from '@preact/signals';
import type { DirNode, Manifest, TimelineBundle, TreeNode } from '@/types';
import { NodeKind } from '@/types';
import { parseDateMs, epochDayAt } from '@/utils/dates';
import { findNodeByPath } from '@/utils/manifest';
import type { ManifestStore, ManifestValue } from './manifest';
import {
  buildPathTimelines,
  ruinStateAt,
  PathState,
  blobShaAt,
  entryAt,
  statsAtDeletion,
  lastModifiedIndexAt,
} from '@/city/timeline/replay';
import type { PathTimeline } from '@/city/timeline/replay';

const EMPTY: ReadonlySet<string> = new Set();

// Record present paths into `out`; returns whether this node is present. A file
// is present when live at pos; a directory is present iff any descendant is.
function _collect(
  node: TreeNode,
  timelines: Map<string, PathTimeline>,
  pos: number,
  out: Set<string>
): boolean {
  if (node.type === NodeKind.File) {
    const pt = node.path != null ? timelines.get(node.path) : undefined;
    const present = pt ? ruinStateAt(pt, pos) === PathState.Present : false;
    if (present && node.path != null) out.add(node.path);
    return present;
  }
  let anyPresent = false;
  for (const child of node.children ?? []) {
    if (_collect(child, timelines, pos, out)) anyPresent = true;
  }
  if (anyPresent && node.path != null) out.add(node.path);
  return anyPresent;
}

/** A file's measures at the scrub position, or at its deletion if already gone. */
export interface ScrubbedFileStats {
  // Null when the blob was never fetched: unknown at this commit, not zero.
  lines: number | null;
  bytes: number | null;
  /** True when these are the values the file had when it was deleted. */
  atDeletion: boolean;
}

// Keep a node iff it's present at the scrubbed commit. A present directory always
// has ≥1 present descendant, so filtering its children never leaves it empty.
function _filterPresent(node: TreeNode, present: ReadonlySet<string>): TreeNode | null {
  if (!present.has(node.path ?? '')) return null;
  if (node.type === NodeKind.File) return node;
  const children: TreeNode[] = [];
  for (const child of node.children ?? []) {
    const kept = _filterPresent(child, present);
    if (kept) children.push(kept);
  }
  return { ...node, children };
}

// ── A folder's rollups at the scrub position ─────────────────────────

// Mirrors api/scan/treebuild.py's accumulator: files add themselves, a finished
// subdirectory is absorbed whole, and the extensionless bucket sorts last.
interface Rollup {
  count: number;
  fileCount: number;
  dirCount: number;
  size: number;
  createdMin: string | null;
  modifiedMax: string | null;
  ext: Map<string | null, { count: number; size: number }>;
}

function _emptyRollup(): Rollup {
  return {
    count: 0,
    fileCount: 0,
    dirCount: 0,
    size: 0,
    createdMin: null,
    modifiedMax: null,
    ext: new Map(),
  };
}

// Empty stands for "no date", so it loses to any real one rather than sorting
// before every ISO string.
function _minIso(a: string | null, b: string | null | undefined): string | null {
  if (!b) return a;
  if (!a) return b;
  return b < a ? b : a;
}

function _maxIso(a: string | null, b: string | null | undefined): string | null {
  if (!b) return a;
  if (!a) return b;
  return b > a ? b : a;
}

function _addExt(roll: Rollup, ext: string | null, count: number, size: number): void {
  const bucket = roll.ext.get(ext);
  if (bucket) {
    bucket.count += count;
    bucket.size += size;
  } else {
    roll.ext.set(ext, { count, size });
  }
}

function _extBreakdown(roll: Rollup): DirNode['descendants_ext_breakdown'] {
  return [...roll.ext.entries()]
    .map(([ext, { count, size }]) => ({ ext, count, size }))
    .sort(
      (a, b) =>
        b.count - a.count ||
        Number(a.ext === null) - Number(b.ext === null) ||
        (a.ext ?? '').localeCompare(b.ext ?? '')
    );
}

/** The commit date of the last change to `path` at or before `pos`. The union's
 *  own `modified` is the last change EVER, which may be in the scrub's future. */
function _modifiedAt(pt: PathTimeline, pos: number, commitDates: (string | undefined)[]): string {
  const idx = lastModifiedIndexAt(pt, pos);
  return commitDates[idx] ?? '';
}

// Post-order, so a directory absorbs children that already know their own
// totals. Returns null for anything absent at `pos`, which prunes emptied dirs.
function _rebuildAt(
  node: TreeNode,
  pos: number,
  timelines: Map<string, PathTimeline>,
  commitDates: (string | undefined)[],
  into: Rollup
): TreeNode | null {
  if (node.type === NodeKind.File) {
    const pt = node.path != null ? timelines.get(node.path) : undefined;
    if (!pt || ruinStateAt(pt, pos) !== PathState.Present) return null;
    const entry = entryAt(pt, pos);
    const size = entry?.bytes ?? 0;
    const created = (node as { created?: string }).created ?? '';
    const modified = _modifiedAt(pt, pos, commitDates);
    const file = { ...node, size, lines: entry?.lines ?? 0, modified } as TreeNode;

    into.count += 1;
    into.fileCount += 1;
    into.size += size;
    into.createdMin = _minIso(into.createdMin, created);
    into.modifiedMax = _maxIso(into.modifiedMax, modified);
    const ext = (node as { extension?: string }).extension;
    _addExt(into, ext ? ext.toLowerCase() : null, 1, size);
    return file;
  }

  const own = _emptyRollup();
  const files: TreeNode[] = [];
  const subdirs: TreeNode[] = [];
  for (const child of node.children ?? []) {
    const kept = _rebuildAt(child, pos, timelines, commitDates, own);
    if (!kept) continue;
    (kept.type === NodeKind.File ? files : subdirs).push(kept);
  }
  if (files.length === 0 && subdirs.length === 0) return null;

  into.count += 1 + own.count;
  into.fileCount += own.fileCount;
  into.dirCount += 1 + own.dirCount;
  into.size += own.size;
  into.createdMin = _minIso(into.createdMin, own.createdMin);
  into.modifiedMax = _maxIso(into.modifiedMax, own.modifiedMax);
  for (const [ext, { count, size }] of own.ext) _addExt(into, ext, count, size);

  const children = [...files, ...subdirs];
  return {
    ...node,
    children,
    children_count: children.length,
    children_file_count: files.length,
    children_dir_count: subdirs.length,
    descendants_count: own.count,
    descendants_file_count: own.fileCount,
    descendants_dir_count: own.dirCount,
    descendants_size: own.size,
    descendants_created_min: own.createdMin,
    descendants_modified_max: own.modifiedMax,
    descendants_ext_breakdown: _extBreakdown(own),
  } as TreeNode;
}

export interface TimelineStore {
  /** Distinct render mode (union city + scrub). */
  readonly mode: Signal<boolean>;
  readonly bundle: Signal<TimelineBundle | null>;
  /** Float commit index, clamped against the loaded bundle, so scrubbing
   *  interpolates and a bundle swap cannot strand it out of range. */
  readonly scrubPos: ReadonlySignal<number>;
  /** Highest valid index, 0 when there is no bundle. */
  readonly scrubMax: ReadonlySignal<number>;
  /** Today, when it is later than the last commit; null when it is not. */
  readonly todayMs: ReadonlySignal<number | null>;
  /** The whole commit scrubPos lands on. */
  readonly scrubCommit: ReadonlySignal<number>;
  /** Anything that would reflow the layout waits for this to clear, or the
   *  track resizes under the pointer mid-drag and the position jumps. */
  readonly dragging: Signal<boolean>;
  /** The commit content fetches key on: follows the scrub but holds still
   *  mid-drag, so dragging a long history doesn't refetch per commit crossed. */
  readonly settledCommit: Signal<number>;
  /** The same rest point as a position: settledCommit caps at the newest
   *  commit, so it cannot tell that stop from the today stop past it. */
  readonly settledPos: Signal<number>;
  /** The tree the panes render: the union filtered to what exists at the
   *  scrub, or this project's live manifest outside the mode. */
  readonly paneManifest: ReadonlySignal<ManifestValue>;
  readonly presentPaths: ReadonlySignal<ReadonlySet<string>>;
  /** The only way to move the scrubber; a readonly scrubPos makes bypassing it
   *  a type error. */
  setScrubPos(pos: number): void;
  /** The moment Timeline treats as now. Set on entry; tests pin it. */
  setTodayMs(ms: number): void;
  /** Called BEFORE the union city is packed: the mode tells the scene layer
   *  whose city to pack. The position follows, once its bundle is loaded. */
  begin(): void;
  /** Shared by every exit path (toggle-off, source switch); scene-free. */
  reset(): void;
  /** A file's measures at the scrub position, or at its deletion if gone. */
  scrubbedStatsFor(path: string): ScrubbedFileStats | null;
  /** Blob sha for a path at the scrub position; null in Live or when absent. */
  scrubbedBlobShaFor(path: string | null | undefined): string | null;
  /** No content to fetch here, so callers must NOT fall back to a by-path read:
   *  that hits HEAD, where a union file may not exist (#122). */
  hasNoContentAtScrub(path: string | null | undefined): boolean;
  /** A directory at the settled commit: the union's structure, every measure
   *  re-added from the per-blob numbers the buildings use. Null in Live. */
  scrubbedDirFor(path: string): DirNode | null;
  dispose(): void;
}

export function createTimelineStore({ manifest }: { manifest: ManifestStore }): TimelineStore {
  const mode = signal(false);
  const bundle = signal<TimelineBundle | null>(null);

  /** How many commits the loaded bundle holds. */
  const commitCount = computed(() => bundle.value?.commits.length ?? 0);

  /** Read once per Timeline entry rather than per frame: the stop today sits at
   *  has to hold still while it is being scrubbed to. */
  const _todayMs = signal(Date.now());

  const todayMs = computed<number | null>(() => {
    const loaded = bundle.value;
    if (!loaded || loaded.commits.length === 0) return null;
    // Parsed the way the bar prints dates, so the stop lands on the day it names.
    const newest = parseDateMs(loaded.commits[loaded.commits.length - 1].date);
    const today = _todayMs.value;
    if (!Number.isFinite(newest)) return null;
    // Whole days: a commit from this morning is not a stop away from now, and a
    // track ending hours past its last tick reads as a rounding error.
    return Math.floor(epochDayAt(today)) > Math.floor(epochDayAt(newest)) ? today : null;
  });

  /** One past the last commit when today is a stop of its own. */
  const scrubMax = computed(
    () => Math.max(0, commitCount.value - 1) + (todayMs.value === null ? 0 : 1)
  );

  const _scrubPos = signal(0);

  // Clamped against the current bundle, not at each write, so a bundle swap
  // alone can't leave a stale position out of range. Readers never clamp.
  const scrubPos: ReadonlySignal<number> = computed(() =>
    Math.min(Math.max(_scrubPos.value, 0), scrubMax.value)
  );

  // The whole commit scrubPos lands on, so anything keyed on presence
  // recomputes once a crossing. Capped: past the last one the city is still
  // its, only older.
  const scrubCommit = computed(() =>
    Math.min(Math.floor(scrubPos.value), Math.max(0, commitCount.value - 1))
  );

  const dragging = signal(false);
  const settledCommit = signal(0);
  const settledPos = signal(0);

  const stopSettle = effect(() => {
    const commit = scrubCommit.value;
    const pos = scrubPos.value;
    if (dragging.value) return;
    batch(() => {
      settledCommit.value = commit;
      settledPos.value = pos;
    });
  });

  // Timelines depend only on the bundle — rebuilt when it changes, NOT per
  // scrub. (A second copy from the scrub controller's; both are pure reads.)
  const _timelines = computed<Map<string, PathTimeline> | null>(() => {
    const loaded = bundle.value;
    return loaded ? buildPathTimelines(loaded) : null;
  });

  const presentPaths: ReadonlySignal<ReadonlySet<string>> = computed(() => {
    if (!mode.value) return EMPTY;
    const loaded = bundle.value;
    const timelines = _timelines.value;
    if (!loaded || !timelines) return EMPTY;
    const pos = scrubCommit.value;
    const tree = (loaded.unionManifest as unknown as { tree?: TreeNode }).tree;
    if (!tree) return EMPTY;
    const out = new Set<string>();
    _collect(tree, timelines, pos, out);
    return out;
  });

  const paneManifest: ReadonlySignal<ManifestValue> = computed(() => {
    const loaded = bundle.value;
    if (!mode.value || !loaded) return manifest.current.value;

    const union = loaded.unionManifest as unknown as ManifestValue;
    const tree = (union as { tree?: DirNode } | null)?.tree;
    if (!tree) return union;

    // Root always stays (an empty tree still needs a container); its children
    // are filtered to the present-at-scrub subtrees.
    const present = presentPaths.value;
    const children: TreeNode[] = [];
    for (const child of tree.children ?? []) {
      const kept = _filterPresent(child, present);
      if (kept) children.push(kept);
    }
    return { ...(union as object), tree: { ...tree, children } } as unknown as ManifestValue;
  });

  function setScrubPos(pos: number): void {
    _scrubPos.value = pos;
  }

  // .value, not .peek(): the footer reads these in render. At the SETTLED
  // commit, so the number always describes the blob the content fetch serves.
  function scrubbedStatsFor(path: string): ScrubbedFileStats | null {
    if (!mode.value) return null;
    const pt = _timelines.value?.get(path);
    if (!pt) return null;
    const pos = settledCommit.value;
    const gone = statsAtDeletion(pt, pos);
    if (gone) return { lines: gone.lines, bytes: gone.bytes, atDeletion: true };
    const entry = entryAt(pt, pos);
    if (!entry) return null;
    return { lines: entry.lines, bytes: entry.bytes, atDeletion: false };
  }

  function scrubbedBlobShaFor(path: string | null | undefined): string | null {
    if (!path || !mode.value) return null;
    const pt = _timelines.value?.get(path);
    // Settled, not live: content fetches wait for the drag to end.
    return pt ? blobShaAt(pt, settledCommit.value) : null;
  }

  function scrubbedDirFor(path: string): DirNode | null {
    if (!mode.value) return null;
    const loaded = bundle.value;
    const timelines = _timelines.value;
    if (!loaded || !timelines) return null;
    const union = (loaded.unionManifest as unknown as { tree?: TreeNode }).tree;
    if (!union) return null;

    const node = findNodeByPath(loaded.unionManifest as unknown as Manifest, path);
    if (!node || node.type !== NodeKind.Directory) return null;

    const commitDates = loaded.commits.map((c) => (c as { date?: string }).date);
    const rebuilt = _rebuildAt(node, settledCommit.value, timelines, commitDates, _emptyRollup());
    return (rebuilt as DirNode | null) ?? null;
  }

  return {
    mode,
    bundle,
    scrubPos,
    scrubMax,
    todayMs,
    scrubCommit,
    dragging,
    settledCommit,
    settledPos,
    paneManifest,
    presentPaths,
    setScrubPos,
    setTodayMs: (ms) => {
      _todayMs.value = ms;
    },
    begin() {
      batch(() => {
        mode.value = true;
        _todayMs.value = Date.now();
      });
    },
    reset() {
      batch(() => {
        mode.value = false;
        setScrubPos(0);
        bundle.value = null;
        dragging.value = false;
      });
    },
    scrubbedStatsFor,
    scrubbedBlobShaFor,
    hasNoContentAtScrub: (path) => mode.value && scrubbedBlobShaFor(path) === null,
    scrubbedDirFor,
    dispose: stopSettle,
  };
}
