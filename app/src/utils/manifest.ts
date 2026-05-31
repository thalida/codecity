// utils/manifest.ts — Pure predicates over the Manifest / DirNode shape.
// Used by views and runtime alike to ask "what does this manifest mean?"
// without reaching into the type structure inline. The sentinel value
// itself lives in constants/manifest.ts; this module is about behaviour.

import type { DirNode, Manifest, TreeNode } from '../types';

/**
 * True when the manifest represents the cold-boot EMPTY_MANIFEST shape
 * (root tree has no name and no children). Used to distinguish "no
 * project loaded yet" from "project loaded but has no content of
 * interest" so callers can show the right empty-state copy.
 *
 * Accepts a few wider shapes so legacy callers passing partial objects
 * (e.g. just a DirNode, or a bag with a `tree` field of unknown shape)
 * still get a sensible answer.
 */
export function isEmptyManifest(
  m: Manifest | DirNode | { tree?: unknown; [k: string]: unknown } | null
): boolean {
  if (!m) return true;
  const tree = (('tree' in m && (m as Manifest).tree) || m) as TreeNode | DirNode;
  if (!tree.name) {
    if (!('children' in tree)) return true;
    return ((tree as DirNode).children?.length ?? 0) === 0;
  }
  return false;
}
