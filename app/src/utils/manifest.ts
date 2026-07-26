// utils/manifest.ts — Pure predicates over, and lookups into, the Manifest shape.

import { EMPTY_MANIFEST } from '@/constants/manifest';
import { NodeKind, type Manifest, type DirNode, type TreeNode } from '@/types';

/**
 * True when nothing meaningful is loaded — either the value is absent or it
 * is the cold-boot sentinel. The "no project loaded" state is always
 * represented by the shared EMPTY_MANIFEST reference (set when there's no
 * ?src, on a load error, or before the first manifest is applied), so an
 * identity check is exact — no structural guessing. A real loaded project
 * is never === EMPTY_MANIFEST.
 */
export function isEmptyManifest(m: unknown): boolean {
  return m == null || m === EMPTY_MANIFEST;
}

// Locate the tree node at `path` (file or directory) in a manifest/DirNode.
// Iterative DFS — called on selection change (rare), so O(nodes) is fine.
export function findNodeByPath(manifest: Manifest | DirNode | null, path: string): TreeNode | null {
  if (!manifest || typeof manifest !== 'object') return null;
  const root = ('tree' in manifest ? (manifest as Manifest).tree : manifest) as DirNode | undefined;
  if (!root || root.type !== NodeKind.Directory) return null;
  const stack: TreeNode[] = [root];
  while (stack.length) {
    const n = stack.pop()!;
    if (n.path === path) return n;
    if (n.type === NodeKind.Directory) for (const c of n.children) stack.push(c);
  }
  return null;
}

/** Manifest-relative path for an absolute one, which is how the replay keys
 *  timelines. Returns '' when the path isn't under the manifest root. */
export function relPathIn(manifest: Manifest | null, fullPath: string): string {
  const root = manifest?.root;
  if (!root || !fullPath.startsWith(root)) return '';
  return fullPath.slice(root.length).replace(/^\/+/, '');
}
