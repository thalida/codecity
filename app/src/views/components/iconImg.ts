// views/components/iconImg.ts — Shared imperative <img> builder for
// Material file/folder icons. Used by makeFileIcon (FileIcon.tsx) and
// makeFolderIcon (FolderIcon.tsx) so the per-image fallback chain
// stays in one place.

import {
  ICON_CDN_BASE,
  GENERIC_FILE,
  GENERIC_FOLDER,
  HARD_FALLBACK_FILE,
  HARD_FALLBACK_FOLDER,
} from '@/constants/fileIcons';

/**
 * Build a `<img class="file-icon">` painting `iconName` from the
 * Material Icon Theme CDN. On a load error, falls back once to the
 * generic file/folder glyph; if THAT fails too, falls back again to
 * the hard `file` / `folder` glyph. `label` is stashed as data-icon-for
 * for test introspection only.
 */
export function makeIconImg(iconName: string, label: string): HTMLImageElement {
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
  img.dataset.iconName = iconName;
  if (label) img.dataset.iconFor = label;
  return img;
}
