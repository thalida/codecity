// state/stores/timeline.ts — the scene city's history, as the app reads it.
//
// The engine itself lives in the city now (city/timeline/state.ts), because a
// bundle is one repo's history and the landing mounts a second city showing a
// different one. What is left here is the app's half: a bound view of the scene
// city's timeline, and the reductions the panes render off it.
//
// Every signal below reads THROUGH the scene handle rather than holding a value
// of its own. One source of truth, and it is the city's — a second copy here
// would be a second answer to "where is the scrubber", which is the class of
// bug this whole refactor is about.

import { computed, effect, type ReadonlySignal } from '@preact/signals';
import { findNodeByPath } from '@/city/utils/manifest';
import { SCENE_HANDLE } from '@/state/stores/city';
import { createTimelineState, type ScrubbedFileStats } from '@/city/timeline/state';
import { MANIFEST, type ManifestValue } from './manifest';
import { ruinStateAt, PathState, entryAt, lastModifiedIndexAt } from '@/city/timeline/replay';
import type { PathTimeline } from '@/city/timeline/replay';
import { DirNode, Manifest, NodeKind, TreeNode } from '@/city/types/manifest';
import { TimelineBundle } from '@/city/types/timeline';

export type { ScrubbedFileStats };

// Before the canvas mounts there is no city to ask, and a boot-time read must
// still answer. Detached: nothing drives it, so it reads as "not in Timeline".
const DETACHED = createTimelineState();

/** The scene city's timeline, or a detached stand-in before it exists. */
function _engine() {
  return SCENE_HANDLE.value?.timeline ?? DETACHED;
}

// ── Mode, history, and where you are in it ───────────────────────────

export const TIMELINE_MODE: ReadonlySignal<boolean> = computed(() => _engine().mode.value);
export const TIMELINE_BUNDLE: ReadonlySignal<TimelineBundle | null> = computed(
  () => _engine().bundle.value
);
export const SCRUB_TODAY_MS: ReadonlySignal<number | null> = computed(
  () => _engine().todayMs.value
);
export const SCRUB_MAX: ReadonlySignal<number> = computed(() => _engine().max.value);
export const SCRUB_POS: ReadonlySignal<number> = computed(() => _engine().pos.value);
export const SCRUB_COMMIT: ReadonlySignal<number> = computed(() => _engine().commit.value);
export const SETTLED_COMMIT: ReadonlySignal<number> = computed(() => _engine().settledCommit.value);
export const SETTLED_POS: ReadonlySignal<number> = computed(() => _engine().settledPos.value);

/** Writable: the scrubber holds it down while you drag. */
export const SCRUB_DRAGGING = {
  get value(): boolean {
    return _engine().dragging.value;
  },
  set value(next: boolean) {
    _engine().dragging.value = next;
  },
  peek(): boolean {
    return _engine().dragging.peek();
  },
};

/** The only way to move the scrubber; readonly SCRUB_POS makes bypassing it a
 *  type error. */
export function setScrubPos(pos: number): void {
  _engine().setPosition(pos);
}

/** The history the scene city is scrubbing. */
export function setTimelineBundle(bundle: TimelineBundle | null): void {
  _engine().setBundle(bundle);
}

/** The moment Timeline treats as now. Set on entry; tests pin it. */
export function setTodayMs(ms: number): void {
  _engine().setTodayMs(ms);
}

// Called BEFORE the union city is packed: the mode tells the renderer whose
// city to pack. The position follows, once its bundle is loaded.
export function beginTimelineMode(): void {
  _engine().enter();
}

// Shared by every exit path (toggle-off, source switch): the mode goes, and so
// does the history it was showing.
export function resetTimelineMode(): void {
  _engine().exit();
}

/** Leave the mode but keep the loaded history, so re-entering lands on the
 *  bundle and position it left. */
export function leaveTimelineMode(): void {
  _engine().setMode(false);
}

export function scrubbedStatsFor(path: string): ScrubbedFileStats | null {
  return _engine().scrubbedStatsFor(path);
}

export function scrubbedBlobShaFor(path: string | null | undefined): string | null {
  return _engine().scrubbedBlobShaFor(path);
}

export function hasNoContentAtScrub(path: string | null | undefined): boolean {
  return _engine().hasNoContentAtScrub(path);
}

const _TIMELINES: ReadonlySignal<Map<string, PathTimeline> | null> = computed(
  () => _engine().timelines.value
);

// ── What that position implies ───────────────────────────────────────

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

export const PRESENT_PATHS: ReadonlySignal<ReadonlySet<string>> = computed(() => {
  if (!TIMELINE_MODE.value) return EMPTY;
  const bundle = TIMELINE_BUNDLE.value;
  const timelines = _TIMELINES.value;
  if (!bundle || !timelines) return EMPTY;
  const pos = SCRUB_COMMIT.value;
  const tree = (bundle.unionManifest as unknown as { tree?: TreeNode }).tree;
  if (!tree) return EMPTY;
  const out = new Set<string>();
  _collect(tree, timelines, pos, out);
  return out;
});

// ── The tree the panes render ────────────────────────────────────────

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

export const PANE_MANIFEST: ReadonlySignal<ManifestValue> = computed(() => {
  const bundle = TIMELINE_BUNDLE.value;
  if (!TIMELINE_MODE.value || !bundle) return MANIFEST.value;

  const union = bundle.unionManifest as unknown as ManifestValue;
  const tree = (union as { tree?: DirNode } | null)?.tree;
  if (!tree) return union;

  // Root always stays (an empty tree still needs a container); its children are
  // filtered to the present-at-scrub subtrees.
  const present = PRESENT_PATHS.value;
  const children: TreeNode[] = [];
  for (const child of tree.children ?? []) {
    const kept = _filterPresent(child, present);
    if (kept) children.push(kept);
  }
  return { ...(union as object), tree: { ...tree, children } } as unknown as ManifestValue;
});

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

/** A directory at the settled commit: the union's structure, every measure
 *  re-added from the per-blob numbers the buildings use. Null in Live. */
export function scrubbedDirFor(path: string): DirNode | null {
  if (!TIMELINE_MODE.value) return null;
  const bundle = TIMELINE_BUNDLE.value;
  const timelines = _TIMELINES.value;
  if (!bundle || !timelines) return null;
  const union = (bundle.unionManifest as unknown as { tree?: TreeNode }).tree;
  if (!union) return null;

  const node = findNodeByPath(bundle.unionManifest as unknown as Manifest, path);
  if (!node || node.type !== NodeKind.Directory) return null;

  const commitDates = bundle.commits.map((c) => (c as { date?: string }).date);
  const rebuilt = _rebuildAt(node, SETTLED_COMMIT.value, timelines, commitDates, _emptyRollup());
  return (rebuilt as DirNode | null) ?? null;
}
