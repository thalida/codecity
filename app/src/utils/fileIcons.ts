// utils/fileIcons.ts — Pure resolvers from a file/dir node to its
// Material icon basename. Reads the lookup tables in constants/fileIcons.ts.
// Used by the building-roof icon atlas and the tree/preview <img> renderers
// in components/fileIcon.tsx so both key off the same names.

import type { DirNode, FileNode } from '../types';
import { EXT_ICON, NAME_ICON, FOLDER_ICON, GENERIC_FILE, GENERIC_FOLDER } from '../constants/fileIcons';

/**
 * Resolve the Material icon basename for a file node. Lookup order:
 * exact filename > extension > generic. (Exact-filename hints carry
 * richer semantics than the bare extension — package.json → npm,
 * not json.)
 */
export function getFileIconName(file: FileNode | { name?: string; extension?: string }): string {
  const name = (file.name || '').toLowerCase();
  const ext = (file.extension || '').toLowerCase();
  return NAME_ICON[name] ?? EXT_ICON[ext] ?? GENERIC_FILE;
}

/** Material icon basename for a folder — see getFileIconName. */
export function getFolderIconName(dir: DirNode | { name?: string }): string {
  const name = (dir.name || '').toLowerCase();
  return FOLDER_ICON[name] ?? GENERIC_FOLDER;
}
