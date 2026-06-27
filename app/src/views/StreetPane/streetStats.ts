// views/StreetPane/streetStats.ts — pure derivations for the Street pane.
// No signal reads; inputs are plain DirNode fields baked by the backend.

import type { DirNode } from '@/types';
import { pluralize } from '@/utils/format';
import { formatBytes } from '@/utils/bytes';
import { languageLabelForExt } from '@/utils/syntaxLanguages';

// A low-share extension still gets a visible sliver so the row never reads as empty.
const MIN_BAR_PCT = 4;

/** Bar fill percent for one extension, normalized to the busiest extension's
 *  count (the list is pre-sorted count desc, so the top row is always 100%).
 *  0 when there's nothing to normalize against. */
export function extBarPct(count: number, max: number): number {
  if (max <= 0) return 0;
  return Math.max(MIN_BAR_PCT, Math.round((count / max) * 100));
}

export interface StreetSummary {
  /** "214 files · 1.2 MB" — subtree totals. */
  totals: string;
  /** Dominant language label ("TypeScript"), or null when there's no nameable
   *  language (empty dir, or a (none)/unknown-only top extension). */
  language: string | null;
}

/** One-line summary of a directory's subtree: total files + size, plus the
 *  dominant language (from the most common extension). */
export function streetSummary(d: DirNode): StreetSummary {
  const files = d.descendants_file_count ?? 0;
  const totals = `${pluralize(files, 'file')} · ${formatBytes(d.descendants_size ?? 0)}`;
  const top = (d.descendants_ext_breakdown ?? [])[0];
  const language = top ? languageLabelForExt(top.ext) : null;
  return { totals, language };
}
