// components/NodeIcon.tsx — VSCode-style file/folder icon (Material
// Icon Theme, MIT). One component for both tree node kinds: dispatch on
// node.type — directories resolve a folder-* icon keyed by directory name
// (folder-src, folder-config, folder-test, …); files resolve by filename /
// extension.
//
// Returns an <img> pointing at a CDN-hosted SVG; the browser caches per URL
// so a project with N files but only K unique extensions only triggers K
// icon fetches on first paint.
//
// Why not lucide masks: lucide icons render via CSS mask-image so they pick
// up currentColor. The Material icons are full-color brand glyphs — the
// COLOR is the info — so we render them as plain <img> instead. Trade: no
// setting-tint, but every-node-recognizable-at-a-glance is the whole point.
//
// Lookup tables live in constants/fileIcons.ts; the name resolvers live in
// utils/fileIcons.ts. This file just renders.

import './NodeIcon.css';
import type { DirNode, FileNode, TreeNode } from '@/types';
import { NodeKind } from '@/types';
import { MATERIAL_ICON_URLS } from '@/constants/materialIcons';
import { getFileIconName, getFolderIconName } from '@/utils/fileIcons';

export interface NodeIconProps {
  node: TreeNode | { name?: string; type?: NodeKind; extension?: string };
  /** For directories, render the open-folder variant (expanded in the tree). */
  open?: boolean;
}

export function NodeIcon({ node, open = false }: NodeIconProps) {
  const isDir = node.type === NodeKind.Directory;
  const iconName = isDir
    ? getFolderIconName(node as DirNode, open)
    : getFileIconName(node as FileNode);
  const label = node.name || '';
  return (
    <img
      class="file-icon"
      src={MATERIAL_ICON_URLS[iconName]}
      alt=""
      loading="lazy"
      data-icon-name={iconName}
      data-icon-for={label || undefined}
    />
  );
}
