// One of four answers to "which tree does this surface show":
//   manifest         HEAD, the project you opened            (fetched)
//   scrubbedManifest a real scan AT the scrubbed commit      (fetched)
//   presentPaths     the paths alive at that commit          (derived)
//   paneManifest     what the tree and search show           (derived)
//
// The manifest the sidebar tree + search read: while scrubbing, the union
// filtered to the paths present at the scrubbed commit; else the HEAD manifest.
// (README stays on HEAD — it reads MANIFEST directly.)

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
