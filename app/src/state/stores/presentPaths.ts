// Union paths present at the current scrub commit (live files + their ancestor
// dirs). The sidebar tree/search filter to this set. Empty outside Timeline.

import { computed, type ReadonlySignal } from '@preact/signals';
import { TIMELINE_MODE, TIMELINE_BUNDLE, SCRUB_COMMIT, SCRUB_POS } from './timeline';
import { buildPathTimelines, ruinStateAt, linesAt } from '@/city/timeline/replay';
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

// Line count at the current scrub position — the SAME source the building height
// uses (linesAt(pt, SCRUB_POS)). The hover tooltip reads this so what's shown
// equals what drives the height. Null outside Timeline (caller falls back to the
// static FileNode.lines).
export function scrubbedLinesFor(path: string): number | null {
  if (!TIMELINE_MODE.peek()) return null;
  const pt = _TIMELINES.peek()?.get(path);
  if (!pt) return null;
  return Math.round(linesAt(pt, SCRUB_POS.peek()));
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
