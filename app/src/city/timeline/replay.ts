import type { TimelineBundle } from '@/types';

const PRESENCE_RAMP = 0.5;

export interface PathTimeline {
  changes: { i: number; lines: number }[];
  intervals: { start: number; end: number | null }[];
}

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
        pt.changes.push({ i, lines: 0 });
        continue;
      }

      const lines = bundle.blobLines[change.sha] ?? 0;
      const open = pt.intervals[pt.intervals.length - 1];
      if (!open || open.end !== null) pt.intervals.push({ start: i, end: null });
      pt.changes.push({ i, lines });
    }
  });

  return timelines;
}

export function isPresent(pt: PathTimeline, pos: number): boolean {
  return pt.intervals.some((iv) => pos >= iv.start && (iv.end === null || pos < iv.end));
}

export function linesAt(pt: PathTimeline, pos: number): number {
  if (!isPresent(pt, pos)) return 0;

  const { changes } = pt;
  if (pos <= changes[0].i) return changes[0].lines;
  if (pos >= changes[changes.length - 1].i) return changes[changes.length - 1].lines;

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
  return a.lines + (b.lines - a.lines) * t;
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

  for (let idx = 0; idx < pt.intervals.length; idx++) {
    const iv = pt.intervals[idx];
    if (pos >= iv.start && (iv.end === null || pos < iv.end)) {
      // only the genesis interval grows in; a resurrection reappears at full presence
      if (idx === 0) {
        const rampT = pos - iv.start;
        if (rampT < PRESENCE_RAMP) return rampT / PRESENCE_RAMP;
      }
      return 1;
    }
  }

  return ruinFloor;
}
