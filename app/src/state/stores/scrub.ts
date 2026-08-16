// state/stores/scrub.ts — everything the scrub position implies. Timeline owns
// the inputs (bundle + position) and every answer here is derived from them, so
// a pane and the buildings beside it cannot disagree about a commit. Live is the
// degenerate case: no position, so the tree is MANIFEST and the set is empty.

import { computed, type ReadonlySignal } from '@preact/signals';
import { MANIFEST, type ManifestValue } from './manifest';
import { TIMELINE_MODE, TIMELINE_BUNDLE, SCRUB_COMMIT, SETTLED_COMMIT } from './timeline';
import {
  buildPathTimelines,
  ruinStateAt,
  PathState,
  blobShaAt,
  entryAt,
  statsAtDeletion,
} from '@/city/timeline/replay';
import type { PathTimeline } from '@/city/timeline/replay';
import { NodeKind } from '@/types';
import type { DirNode, TreeNode } from '@/types';

const EMPTY: ReadonlySet<string> = new Set();

// Timelines depend only on the bundle — rebuild when it changes, NOT per scrub.
// (A second copy from the scrub controller's; both are pure reads of the bundle.)
const _TIMELINES = computed<Map<string, PathTimeline> | null>(() => {
  const bundle = TIMELINE_BUNDLE.value;
  return bundle ? buildPathTimelines(bundle) : null;
});

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
  lines: number;
  bytes: number;
  /** True when these are the values the file had when it was deleted. */
  atDeletion: boolean;
}

// .value, not .peek(): the footer reads this in render. At the SETTLED commit,
// so the number always describes the blob the content fetch serves.
export function scrubbedStatsFor(path: string): ScrubbedFileStats | null {
  if (!TIMELINE_MODE.value) return null;
  const pt = _TIMELINES.value?.get(path);
  if (!pt) return null;
  const pos = SETTLED_COMMIT.value;
  const gone = statsAtDeletion(pt, pos);
  if (gone) return { lines: gone.lines, bytes: gone.bytes, atDeletion: true };
  const entry = entryAt(pt, pos);
  if (!entry) return null;
  return { lines: entry.lines, bytes: entry.bytes, atDeletion: false };
}

/** Blob sha for a path at the scrub position; null in Live or when absent. */
export function scrubbedBlobShaFor(path: string | null | undefined): string | null {
  if (!path || !TIMELINE_MODE.value) return null;
  const pt = _TIMELINES.value?.get(path);
  // Settled, not live: content fetches wait for the drag to end.
  return pt ? blobShaAt(pt, SETTLED_COMMIT.value) : null;
}

/** No content to fetch at this scrub position, so callers must NOT fall back to
 *  a by-path read: that hits HEAD, where a union file may not exist (#122). */
export function hasNoContentAtScrub(path: string | null | undefined): boolean {
  return TIMELINE_MODE.value && scrubbedBlobShaFor(path) === null;
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
