// views/components/FileIcon.tsx — VSCode-style file icon (Material Icon
// Theme, MIT). Returns an <img> element pointing at a CDN-hosted SVG;
// the browser caches per URL so a project with N files but only K
// unique extensions only triggers K icon fetches on first paint.
//
// Why not lucide masks: lucide icons render via CSS mask-image so they
// pick up currentColor. The Material file icons are full-color brand
// glyphs — the COLOR is the info — so we render them as plain <img>
// instead. Trade: no theme-tint, but every-file-recognizable from a
// glance is the whole point.
//
// Lookup tables live in constants/fileIcons.ts; the file→icon name
// resolver lives in utils/fileIcons.ts. This file just renders.

import type { FileNode } from '@/types';
import { ICON_CDN_BASE } from '@/constants/fileIcons';
import { getFileIconName } from '@/utils/fileIcons';

export interface FileIconProps {
  file: FileNode | { name?: string; extension?: string };
}

export function FileIcon({ file }: FileIconProps) {
  const iconName = getFileIconName(file);
  const label = file.name || '';
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
