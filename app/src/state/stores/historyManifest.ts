// state/stores/historyManifest.ts — the manifest the left-sidebar file tree +
// search read. While scrubbing, the all-time UNION manifest (so deleted paths
// still appear and can be inspected); otherwise the live HEAD manifest. The
// README pane stays on HEAD (it fetches the current checkout), so it reads
// MANIFEST directly rather than this.
//
// The union is filtered to honor the same toggles as the city: deleted (ruin)
// paths are hidden when "Show deleted files" is off, and future (not-yet-created)
// paths are hidden when "Show future files" is off — so the sidebar shows exactly
// the set of paths the scene renders at this commit.

import { computed, type ReadonlySignal } from '@preact/signals';
import { MANIFEST, type ManifestValue } from './manifest';
import { TIMELINE_MODE, TIMELINE_BUNDLE } from './timeline';
import { HISTORY_NODE_STATE, HistoryState } from './historyNodeState';
import { RUINS } from './settings/ruins';
import { BLUEPRINTS } from './settings/blueprints';
import { NodeKind } from '@/types';
import type { TreeNode } from '@/types';

// Keep a node iff its scrub-relative state is enabled. Directories are dropped
// when nothing under them survives (empty folders would just be clutter), except
// the root, which always stays so the tree still has a container to render.
function _filterVisible(
  node: TreeNode,
  states: ReadonlyMap<string, HistoryState>,
  showDeleted: boolean,
  showFuture: boolean,
  isRoot: boolean
): TreeNode | null {
  if (node.type === NodeKind.File) {
    const st = states.get(node.path ?? '');
    if (st === HistoryState.Deleted && !showDeleted) return null;
    if (st === HistoryState.Future && !showFuture) return null;
    return node;
  }
  const children: TreeNode[] = [];
  for (const child of node.children ?? []) {
    const kept = _filterVisible(child, states, showDeleted, showFuture, false);
    if (kept) children.push(kept);
  }
  if (!isRoot && children.length === 0) return null;
  return { ...node, children };
}

export const HISTORY_MANIFEST: ReadonlySignal<ManifestValue> = computed(() => {
  const bundle = TIMELINE_BUNDLE.value;
  if (!TIMELINE_MODE.value || !bundle) return MANIFEST.value;

  const union = bundle.unionManifest as unknown as ManifestValue;
  const showDeleted = RUINS.value.ENABLED;
  const showFuture = BLUEPRINTS.value.ENABLED;
  // Nothing hidden → the raw union, no per-commit tree rebuild.
  if (showDeleted && showFuture) return union;

  const tree = (union as { tree?: TreeNode } | null)?.tree;
  if (!tree) return union;
  const filtered = _filterVisible(tree, HISTORY_NODE_STATE.value, showDeleted, showFuture, true);
  return { ...(union as object), tree: filtered } as unknown as ManifestValue;
});
