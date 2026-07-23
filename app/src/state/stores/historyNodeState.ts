// state/stores/historyNodeState.ts — per-path state of the union tree at the
// current scrub position, for the left-sidebar tree + search to mark deleted
// (ruin) and future (not-yet-created) paths. Scrub-relative, so the sidebar
// tracks exactly what the 3D city shows as you scrub.
//
// Files map straight off the replay timeline; a directory inherits the
// strongest state of its descendants (present > deleted > future), matching how
// the scrub controller decides a street's state from its buildings.

import { computed, type ReadonlySignal } from '@preact/signals';
import { TIMELINE_MODE, TIMELINE_BUNDLE, SCRUB_POS } from './timeline';
import { buildPathTimelines, ruinStateAt } from '@/city/timeline/replay';
import type { PathTimeline } from '@/city/timeline/replay';
import { NodeKind } from '@/types';
import type { TreeNode } from '@/types';

export enum HistoryState {
  Present = 'present',
  Deleted = 'deleted',
  Future = 'future',
}

const EMPTY: ReadonlyMap<string, HistoryState> = new Map();

// Timelines depend only on the bundle — rebuild when it changes, NOT per scrub.
// (A second copy from the scrub controller's; both are pure reads of the bundle.)
const _TIMELINES = computed<Map<string, PathTimeline> | null>(() => {
  const bundle = TIMELINE_BUNDLE.value;
  return bundle ? buildPathTimelines(bundle) : null;
});

function _walk(
  node: TreeNode,
  timelines: Map<string, PathTimeline>,
  pos: number,
  out: Map<string, HistoryState>
): HistoryState {
  if (node.type === NodeKind.File) {
    const pt = node.path != null ? timelines.get(node.path) : undefined;
    const st = pt ? ruinStateAt(pt, pos) : 'absent';
    const state =
      st === 'present'
        ? HistoryState.Present
        : st === 'ruin'
          ? HistoryState.Deleted
          : HistoryState.Future;
    if (node.path != null) out.set(node.path, state);
    return state;
  }
  let hasPresent = false;
  let hasDeleted = false;
  for (const child of node.children ?? []) {
    const cs = _walk(child, timelines, pos, out);
    if (cs === HistoryState.Present) hasPresent = true;
    else if (cs === HistoryState.Deleted) hasDeleted = true;
  }
  const state = hasPresent
    ? HistoryState.Present
    : hasDeleted
      ? HistoryState.Deleted
      : HistoryState.Future;
  if (node.path != null) out.set(node.path, state);
  return state;
}

// path -> state at the current scrub position (empty outside Timeline). Reading
// `.value` in a tree row subscribes it, so rows re-mark as the scrub moves.
export const HISTORY_NODE_STATE: ReadonlySignal<ReadonlyMap<string, HistoryState>> = computed(
  () => {
    if (!TIMELINE_MODE.value) return EMPTY;
    const bundle = TIMELINE_BUNDLE.value;
    const timelines = _TIMELINES.value;
    if (!bundle || !timelines) return EMPTY;
    const pos = SCRUB_POS.value;
    const tree = (bundle.unionManifest as unknown as { tree?: TreeNode }).tree;
    if (!tree) return EMPTY;
    const out = new Map<string, HistoryState>();
    _walk(tree, timelines, pos, out);
    return out;
  }
);
