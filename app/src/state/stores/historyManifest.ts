// state/stores/historyManifest.ts — the manifest the left-sidebar file tree +
// search read. While scrubbing, the union manifest filtered to just the paths
// PRESENT at the scrubbed commit (deleted + not-yet-created paths are excluded),
// so the tree/search always match what's actually alive in the city at that
// point in history. Outside Timeline it's the live HEAD manifest.
//
// The README pane stays on HEAD (it fetches the current checkout), so it reads
// MANIFEST directly rather than this.

import { computed, type ReadonlySignal } from '@preact/signals';
import { MANIFEST, type ManifestValue } from './manifest';
import { TIMELINE_MODE, TIMELINE_BUNDLE } from './timeline';
import { PRESENT_PATHS } from './presentPaths';
import { NodeKind } from '@/types';
import type { DirNode, TreeNode } from '@/types';

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

export const HISTORY_MANIFEST: ReadonlySignal<ManifestValue> = computed(() => {
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
