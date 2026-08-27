import { DirNode, Manifest, NodeKind, SourceRef, TreeNode } from '@/city/types/manifest';
// utils/manifest.ts — Pure predicates over, and lookups into, the Manifest shape.

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

/** The source a manifest was built for: what a read sends back so the server
 *  can resolve its paths. Null manifest, null source, nothing to read. */
export function sourceOf(manifest: Manifest | null): SourceRef | null {
  return manifest ? { src: manifest.src, branch: manifest.branch } : null;
}
