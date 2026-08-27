// utils/syntaxLanguages.ts — a file to its hljs language id, and an id to its
// label, over the tables in constants/syntaxLanguageMap.

import type { FileNode } from '@/city/types/manifest';
import { EXT_LANG, NAME_LANG, LANGUAGE_LABELS } from '../constants/syntaxLanguageMap';

/** A file's hljs language id by extension, then exact filename. null is the
 *  legitimate "let hljs auto-detect" answer. */
export function languageFor(file: { extension?: string; name?: string }): string | null {
  const ext = (file.extension || '').toLowerCase();
  if (ext && EXT_LANG[ext]) return EXT_LANG[ext];
  const name = (file.name || '').toLowerCase();
  if (NAME_LANG[name]) return NAME_LANG[name];
  return null;
}

/** A file's language as a person reads it: the label for a known id, the
 *  uppercased extension for an unknown one, else "Plain Text". */
export function humanLanguageFor(file: FileNode): string {
  const key = languageFor(file);
  if (!key) {
    if (file.extension) return file.extension.replace(/^\./, '').toUpperCase();
    return 'Plain Text';
  }
  return LANGUAGE_LABELS[key] || key;
}

/** ".ts" → "TypeScript", an unknown extension uppercased, and null when there
 *  is no extension at all, so callers drop the clause rather than print one. */
export function languageLabelForExt(ext: string | null): string | null {
  if (!ext) return null;
  const key = EXT_LANG[ext.toLowerCase()];
  if (key) return LANGUAGE_LABELS[key] || key;
  return ext.replace(/^\./, '').toUpperCase();
}
