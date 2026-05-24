// Test helper: build CommitEntry[] from terse `{date, files}` literals,
// auto-computing `gap_days` the same way the scanner does
// (codecity/scan.py::_backfill_gap_days):
//   - index 0 → gap_days = 0 (no previous commit)
//   - index i → max(0, days(commits[i].date) - days(commits[i-1].date))
//
// Tests use this so per-test fixtures stay focused on the fields each
// case actually exercises (date + files); the precomputed-by-scanner
// gap_days field comes along automatically.

import type { CommitEntry } from '@/types';

type Partial = Pick<CommitEntry, 'date' | 'files'>;

export function commits(...entries: Partial[]): CommitEntry[] {
  const out: CommitEntry[] = [];
  let prev: number | null = null;
  for (const e of entries) {
    const t = _utcDays(e.date);
    const gap_days = prev === null ? 0 : Math.max(0, t - prev);
    out.push({ ...e, gap_days });
    prev = t;
  }
  return out;
}

// Days since epoch, computed in UTC to stay timezone-independent. Avoids
// `Date.parse` because its handling of bare YYYY-MM-DD strings varies
// across JS engines.
function _utcDays(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}
