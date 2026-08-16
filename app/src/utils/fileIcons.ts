// utils/fileIcons.ts — Pure resolvers from a file/dir node to its
// Material icon basename. Reads the lookup tables in constants/fileIcons.ts.
// Used by the building-roof icon atlas and the tree/preview <img> renderers
// in components/NodeIcon.tsx so both key off the same names.

import type { DirNode, FileNode } from '../types';
import { isDataBuilding } from './fileKind';
import {
  EXT_ICON,
  NAME_ICON,
  FOLDER_ICON,
  GENERIC_FILE,
  GENERIC_BINARY,
  GENERIC_FOLDER,
} from '../constants/fileIcons';

/** Icon basename by exact filename, then extension, then generic: package.json
 *  means npm, not json. An unmatched binary gets the raw-bytes glyph. */
export function getFileIconName(
  file:
    | FileNode
    | { name?: string; extension?: string; binary?: boolean; mediaKind?: 'image' | 'video' | null }
): string {
  const name = (file.name || '').toLowerCase();
  const ext = (file.extension || '').toLowerCase();
  const specific = NAME_ICON[name] ?? EXT_ICON[ext];
  if (specific) return specific;
  return isDataBuilding(file) ? GENERIC_BINARY : GENERIC_FILE;
}

/** Material icon basename for a folder — see getFileIconName. */
export function getFolderIconName(dir: DirNode | { name?: string }, open = false): string {
  const name = (dir.name || '').toLowerCase();
  const base = FOLDER_ICON[name] ?? GENERIC_FOLDER;
  // Every Material folder glyph ships an `-open` twin for the expanded state.
  return open ? `${base}-open` : base;
}
