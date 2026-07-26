// Union paths present at the current scrub commit (live files + their ancestor
// dirs). The sidebar tree/search filter to this set. Empty outside Timeline.

import { computed, type ReadonlySignal } from '@preact/signals';
import {
  TIMELINE_MODE,
  TIMELINE_BUNDLE,
  SCRUB_COMMIT,
  SCRUB_POS,
  SETTLED_COMMIT,
} from './timeline';
import {
  buildPathTimelines,
  ruinStateAt,
  linesAt,
  bytesAt,
  blobShaAt,
  statsAtDeletion,
} from '@/city/timeline/replay';
import type { PathTimeline } from '@/city/timeline/replay';
import { NodeKind } from '@/types';
import type { TreeNode } from '@/types';

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
    const present = pt ? ruinStateAt(pt, pos) === 'present' : false;
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

// .value, not .peek(): the footer calls this in render and must re-render as the scrub moves.
export function scrubbedStatsFor(path: string): ScrubbedFileStats | null {
  if (!TIMELINE_MODE.value) return null;
  const pt = _TIMELINES.value?.get(path);
  if (!pt) return null;
  const pos = SCRUB_POS.value;
  const gone = statsAtDeletion(pt, pos);
  if (gone) return { lines: gone.lines, bytes: gone.bytes, atDeletion: true };
  return {
    lines: Math.round(linesAt(pt, pos)),
    bytes: Math.round(bytesAt(pt, pos)),
    atDeletion: false,
  };
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
