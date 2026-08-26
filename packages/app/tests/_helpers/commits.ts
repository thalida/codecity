// Test helper: build CommitEntry[] from terse `{date, files}` literals.
// Tests use this so per-test fixtures stay focused on the fields each
// case exercises (date + files) without re-stating the type shape.
// `authors`, `subject`, `sha`, and `same_day_total` are optional — sensible
// defaults are filled in when omitted so callers stay terse.
//
// same_day_total defaults to the size of each commit's date-group across the
// passed entries — mirroring the backend's _annotate_same_day_totals — so the
// tree-color tests that pass multiple `{date}` literals get the per-day counts
// they exercise without hand-stating them. Callers can override per entry.

import type { CommitEntry } from '@/types';

export function commits(
  ...entries: (Omit<CommitEntry, 'sha' | 'authors' | 'subject' | 'same_day_total'> & {
    sha?: string;
    authors?: string[];
    subject?: string;
    same_day_total?: number;
  })[]
): CommitEntry[] {
  const perDay = new Map<string, number>();
  for (const e of entries) perDay.set(e.date, (perDay.get(e.date) ?? 0) + 1);
  return entries.map((e, i) => ({
    authors: [`Author ${i}`],
    subject: `commit ${i}`,
    same_day_total: perDay.get(e.date) ?? 1,
    ...e,
    // Distinct per entry: the sha-keyed lookups (findTreeBySha, colorForSha)
    // cannot be exercised when every fixture commit shares one.
    sha: e.sha ?? String(i).padStart(40, '0'),
  }));
}

/** `n` commits on consecutive days, oldest first. `filesAt` sets each entry's
 *  file count; the default gives every commit a distinct one. */
export function commitSeries(
  n: number,
  filesAt: (i: number) => number = (i) => i + 1
): CommitEntry[] {
  const base = Date.UTC(2026, 0, 1);
  return commits(
    ...Array.from({ length: n }, (_, i) => ({
      date: new Date(base + i * 86_400_000).toISOString().slice(0, 10),
      files: filesAt(i),
    }))
  );
}
