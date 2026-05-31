// views/components/FolderIcon.tsx — VSCode-style folder icon (Material
// Icon Theme, MIT). Sibling to FileIcon — same rendering surface, but
// the resolver picks the folder-icon name keyed by directory name
// (folder-src, folder-config, folder-test, …). See FileIcon.tsx for
// rationale on why these are plain <img> instead of mask-image SVGs.

import type { DirNode } from '@/types';
import { ICON_CDN_BASE } from '@/constants/fileIcons';
import { getFolderIconName } from '@/utils/fileIcons';
import { makeIconImg } from './iconImg';

export interface FolderIconProps {
  dir: DirNode | { name?: string };
}

export function FolderIcon({ dir }: FolderIconProps) {
  const iconName = getFolderIconName(dir);
  const label = dir.name || '';
  return (
    <img
      class="file-icon"
      src={`${ICON_CDN_BASE}${iconName}.svg`}
      alt=""
      loading="lazy"
      data-icon-name={iconName}
      data-icon-for={label || undefined}
    />
  );
}

/** Imperative DOM factory — same renderer, for callers that haven't yet
 *  ported to Preact. Phase 3c/3d will delete it. */
export function makeFolderIcon(dir: DirNode | { name?: string }): HTMLImageElement {
  return makeIconImg(getFolderIconName(dir), dir.name || '');
}
