// utils/fileIcons.ts — Pure resolvers from a file/dir node to its
// Material icon basename. Reads the lookup tables in constants/fileIcons.ts.
// Used by the building-roof icon atlas and the tree/preview <img> renderers
// in components/NodeIcon.tsx so both key off the same names.

import type { DirNode, FileNode } from '../types';
import {
  EXT_ICON,
  NAME_ICON,
  FOLDER_ICON,
  GENERIC_FILE,
  GENERIC_BINARY,
  GENERIC_FOLDER,
} from '../constants/fileIcons';

/**
 * Resolve the Material icon basename: exact filename > extension > generic
 * (filename hints carry richer semantics than the bare extension — package.json
 * → npm, not json). A binary "data" file with no specific match falls back to the
 * hex "raw bytes" glyph instead of the generic document — but a known binary type
 * (audio, font, database, …) keeps its own icon.
 */
export function getFileIconName(
  file:
    | FileNode
    | { name?: string; extension?: string; binary?: boolean; mediaKind?: string | null }
): string {
  const name = (file.name || '').toLowerCase();
  const ext = (file.extension || '').toLowerCase();
  const specific = NAME_ICON[name] ?? EXT_ICON[ext];
  if (specific) return specific;
  return file.binary && !file.mediaKind ? GENERIC_BINARY : GENERIC_FILE;
}

/** Material icon basename for a folder — see getFileIconName. */
export function getFolderIconName(dir: DirNode | { name?: string }, open = false): string {
  const name = (dir.name || '').toLowerCase();
  const base = FOLDER_ICON[name] ?? GENERIC_FOLDER;
  // Every Material folder glyph ships an `-open` twin for the expanded state.
  return open ? `${base}-open` : base;
}
