// components/nodes/NodeIcon/NodeIcon.tsx — the Material Icon Theme glyph for a
// node. Rendered as <img>, not a lucide-style mask, because the COLOUR is the
// information: these are full-colour brand glyphs, so they cannot take
// currentColor. The browser caches per URL, so N files cost K unique fetches.
import {
  MATERIAL_ICON_URLS,
  getFileIconName,
  getFolderIconName,
  type DirNode,
  type FileNode,
  NodeKind,
  type TreeNode,
} from '@codecity/city';
import './NodeIcon.css';

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
