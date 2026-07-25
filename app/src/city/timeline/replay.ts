import type { TimelineBundle } from '@/types';

export interface PathTimeline {
  changes: { i: number; lines: number; bytes: number }[];
  intervals: { start: number; end: number | null }[];
}

/** The per-commit measures a change entry carries, both replayed the same way. */
type ChangeMeasure = 'lines' | 'bytes';

// Mirrors the backend replay: walking deltas[0..i] reproduces the file set + lines at commit i.
// Intervals (not a single created/deleted pair) let a resurrected path have a dead gap in between.
export function buildPathTimelines(bundle: TimelineBundle): Map<string, PathTimeline> {
  const timelines = new Map<string, PathTimeline>();

  bundle.deltas.forEach((delta, i) => {
    for (const change of delta.changes) {
      let pt = timelines.get(change.path);
      if (!pt) {
        pt = { changes: [], intervals: [] };
        timelines.set(change.path, pt);
      }

      if (change.sha === null) {
        const open = pt.intervals[pt.intervals.length - 1];
        if (open && open.end === null) open.end = i;
        pt.changes.push({ i, lines: 0, bytes: 0 });
        continue;
      }

      const lines = bundle.blobLines[change.sha] ?? 0;
      const bytes = bundle.blobSizes[change.sha] ?? 0;
      const open = pt.intervals[pt.intervals.length - 1];
      if (!open || open.end !== null) pt.intervals.push({ start: i, end: null });
      pt.changes.push({ i, lines, bytes });
    }
  });

  return timelines;
}

export function isPresent(pt: PathTimeline, pos: number): boolean {
  return pt.intervals.some((iv) => pos >= iv.start && (iv.end === null || pos < iv.end));
}

// Scrub position is continuous, so interpolate between the surrounding entries.
function _measureAt(pt: PathTimeline, pos: number, measure: ChangeMeasure): number {
  const { changes } = pt;
  if (pos <= changes[0].i) return changes[0][measure];
  if (pos >= changes[changes.length - 1].i) return changes[changes.length - 1][measure];

  let lo = 0;
  let hi = changes.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (changes[mid].i <= pos) lo = mid;
    else hi = mid;
  }

  const a = changes[lo];
  const b = changes[hi];
  const t = (pos - a.i) / (b.i - a.i);
  return a[measure] + (b[measure] - a[measure]) * t;
}

export function linesAt(pt: PathTimeline, pos: number): number {
  return isPresent(pt, pos) ? _measureAt(pt, pos, 'lines') : 0;
}

export function bytesAt(pt: PathTimeline, pos: number): number {
  return isPresent(pt, pos) ? _measureAt(pt, pos, 'bytes') : 0;
}

/** What a path measured when it was deleted, or null if it is not gone at `pos`. */
export function statsAtDeletion(
  pt: PathTimeline,
  pos: number
): { lines: number; bytes: number } | null {
  if (isPresent(pt, pos)) return null;

  // Latest close, not the first: a path can be deleted and resurrected.
  let deletedAt: number | null = null;
  for (const iv of pt.intervals) {
    if (iv.end !== null && iv.end <= pos) deletedAt = iv.end;
  }
  if (deletedAt === null) return null;

  let last: PathTimeline['changes'][number] | null = null;
  for (const c of pt.changes) {
    if (c.i >= deletedAt) break;
    last = c;
  }
  return last ? { lines: last.lines, bytes: last.bytes } : null;
}

// Latest change index <= pos, for scrub-relative recency (weathering).
export function lastModifiedIndexAt(pt: PathTimeline, pos: number): number {
  const { changes } = pt;
  if (changes.length === 0) return 0;
  if (pos <= changes[0].i) return changes[0].i;
  if (pos >= changes[changes.length - 1].i) return changes[changes.length - 1].i;

  let lo = 0;
  let hi = changes.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (changes[mid].i <= pos) lo = mid;
    else hi = mid;
  }
  return changes[lo].i;
}

// 'absent' = before the path's first commit (nothing to show). 'present' = live
// at pos. 'ruin' = existed once, then deleted (in a dead gap or past the last
// interval) — the only state ghost-ruins render.
export function ruinStateAt(pt: PathTimeline, pos: number): 'present' | 'ruin' | 'absent' {
  if (pt.intervals.length === 0 || pos < pt.intervals[0].start) return 'absent';
  for (const iv of pt.intervals) {
    if (pos >= iv.start && (iv.end === null || pos < iv.end)) return 'present';
  }
  return 'ruin';
}

export function presenceAt(pt: PathTimeline, pos: number, ruinFloor: number): number {
  if (pt.intervals.length === 0 || pos < pt.intervals[0].start) return 0;

  // A file is fully present at every commit inside a live interval — including the
  // commit it was created at (a snapshot at that commit contains it). No genesis
  // grow-in ramp: landing on a file's creation commit (or on HEAD after a rename
  // records the moved file as freshly created) must show it, not fade it from 0.
  for (const iv of pt.intervals) {
    if (pos >= iv.start && (iv.end === null || pos < iv.end)) return 1;
  }

  return ruinFloor;
}
