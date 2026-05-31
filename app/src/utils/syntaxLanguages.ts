// utils/syntaxLanguages.ts — Resolve file → hljs language id, and
// language id → human-readable label. Reads the lookup tables in
// constants/syntaxLanguages.ts.

import type { FileNode } from '../types';
import { EXT_LANG, NAME_LANG, LANGUAGE_LABELS } from '../constants/syntaxLanguages';

/**
 * Resolve a file's hljs language id, or null if no hint matches.
 * Lookup order: extension > exact filename. Returning null is a
 * legitimate "let hljs auto-detect" signal.
 */
export function languageFor(file: { extension?: string; name?: string }): string | null {
  const ext = (file.extension || '').toLowerCase();
  if (ext && EXT_LANG[ext]) return EXT_LANG[ext];
  const name = (file.name || '').toLowerCase();
  if (NAME_LANG[name]) return NAME_LANG[name];
  return null;
}

/**
 * Map a file to a human-readable language label.
 *   - Known hljs id → display label from LANGUAGE_LABELS.
 *   - Unknown id but has extension → uppercased extension (e.g. "EXR").
 *   - No id at all → "Plain Text".
 */
export function humanLanguageFor(file: FileNode): string {
  const key = languageFor(file);
  if (!key) {
    if (file.extension) return file.extension.replace(/^\./, '').toUpperCase();
    return 'Plain Text';
  }
  return LANGUAGE_LABELS[key] || key;
}
