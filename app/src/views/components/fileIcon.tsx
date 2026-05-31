// views/components/fileIcon.tsx — VSCode-style file/folder icon renderers
// (Material Icon Theme, MIT). Returns an <img> element pointing at a
// CDN-hosted SVG; the browser caches per URL so a project with N files
// but only K unique extensions only triggers K icon fetches on first paint.
//
// Why not lucide masks: lucide icons render via CSS mask-image so they
// pick up currentColor. The Material file icons are full-color brand
// glyphs — the COLOR is the info — so we render them as plain <img>
// instead. Trade: no theme-tint, but every-file-recognizable from a
// glance is the whole point.
//
// Lookup tables live in constants/fileIcons.ts; the file/folder→icon
// name resolvers live in utils/fileIcons.ts. This file just renders.
//
// Preact components: FileIcon, FolderIcon.
// Backward-compat factories: makeFileIcon, makeFolderIcon (used by panes/
// shell until Phases 3c/3d port them).

import { NodeKind } from '@/types';
import type { DirNode, FileNode } from '@/types';
import {
  ICON_CDN_BASE,
  GENERIC_FILE,
  GENERIC_FOLDER,
  HARD_FALLBACK_FILE,
  HARD_FALLBACK_FOLDER,
} from '@/constants/fileIcons';
import { getFileIconName, getFolderIconName } from '@/utils/fileIcons';

// Re-export so older callers (e.g. the building icon atlas) can still
// import the CDN base from here.
export { FILE_ICON_CDN_BASE } from '@/constants/fileIcons';
export { getFileIconName, getFolderIconName } from '@/utils/fileIcons';

// ── Preact components ───────────────────────────────────────────────────────

export interface FileIconProps {
  file: FileNode | { name?: string; extension?: string };
}

export interface FolderIconProps {
  dir: DirNode | { name?: string };
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

// ── Backward-compat factories (Phase 3c/3d will delete these) ──────────────

/** Build the <img> for a file node, with extension/name lookups + fallback. */
export function makeFileIcon(
  file: FileNode | { name?: string; extension?: string }
): HTMLImageElement {
  return _makeIcon(getFileIconName(file), file.name || '');
}

/** Build the <img> for a folder node, with name lookup + generic fallback. */
export function makeFolderIcon(dir: DirNode | { name?: string }): HTMLImageElement {
  return _makeIcon(getFolderIconName(dir), dir.name || '');
}

function _makeIcon(iconName: string, label: string): HTMLImageElement {
  const img = document.createElement('img');
  img.className = 'file-icon';
  img.src = `${ICON_CDN_BASE}${iconName}.svg`;
  img.alt = ''; // decorative — the label next to it carries the name
  img.loading = 'lazy';
  // Defensive: if a less-common icon name 404s, fall back to the
  // generic file/folder glyph (once — guarded against infinite loops).
  // Second-chance fallback is the unconditionally-present `file` /
  // `folder` glyph so a typo in our map (or a removed icon in a
  // theme bump) can't leave the row with a broken-image marker.
  let fellBack = false;
  img.addEventListener('error', () => {
    if (fellBack) return;
    fellBack = true;
    const isFolder = iconName.startsWith('folder');
    // If the failure WAS the generic icon, jump straight to the hard
    // fallback to avoid a no-op same-url retry.
    const next =
      iconName === GENERIC_FOLDER || iconName === GENERIC_FILE
        ? isFolder
          ? HARD_FALLBACK_FOLDER
          : HARD_FALLBACK_FILE
        : isFolder
          ? GENERIC_FOLDER
          : GENERIC_FILE;
    img.src = `${ICON_CDN_BASE}${next}.svg`;
  });
  // Stash so callers can introspect during tests / debugging.
  if (typeof NodeKind !== 'undefined') {
    img.dataset.iconName = iconName;
    if (label) img.dataset.iconFor = label;
  }
  return img;
}
