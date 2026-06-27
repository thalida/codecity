// views/StreetPane/streetStats.ts — pure derivations for the Street pane's
// ranked by-extension bars. No signal reads; inputs are plain counts/extensions.

import { languageLabelForExt } from '@/utils/syntaxLanguages';
import { formatShortDate } from '@/utils/dates';

// A low-share extension still gets a visible sliver so the row never reads as empty.
const MIN_BAR_PCT = 4;

/** Bar fill percent for one extension as its share of the directory's total
 *  files. 0 when there are no files to take a share of. */
export function extBarPct(count: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(MIN_BAR_PCT, Math.round((count / total) * 100));
}

/** This extension's share of the directory's files as a display string ("64%",
 *  or "<1%" for a nonzero share that rounds down to zero). */
export function extShareLabel(count: number, total: number): string {
  if (total <= 0) return '0%';
  const pct = Math.round((count / total) * 100);
  return pct === 0 && count > 0 ? '<1%' : `${pct}%`;
}

/** Full file-type name for the row tooltip: the language label plus the exact
 *  extension ("TypeScript (.ts)"), or "No extension" for extensionless files.
 *  Unknown extensions fall back to the uppercased ext ("SKETCH (.sketch)"). */
export function extTypeLabel(ext: string): string {
  if (ext === '(none)') return 'No extension';
  const name = languageLabelForExt(ext);
  return name ? `${name} (${ext})` : ext;
}

/** Display span from the directory's oldest-created to newest-modified file
 *  ("Mar 12, 2024 → Jun 20, 2026"), collapsed to one date when they're equal,
 *  or null when the directory has no dated files. */
export function streetDateRange(from: string | null, to: string | null): string | null {
  if (!from || !to) return null;
  const a = formatShortDate(from);
  const b = formatShortDate(to);
  return a === b ? a : `${a} → ${b}`;
}
