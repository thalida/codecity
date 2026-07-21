import type { TimelineBundle } from '@/types';

const PRESENCE_RAMP = 0.5;

export interface PathTimeline {
  changes: { i: number; lines: number }[];
  createdIdx: number;
  deletedIdx: number | null;
}

// Mirrors the backend replay: walking deltas[0..i] reproduces the file set + lines at commit i.
export function buildPathTimelines(bundle: TimelineBundle): Map<string, PathTimeline> {
  const timelines = new Map<string, PathTimeline>();

  bundle.deltas.forEach((delta, i) => {
    for (const change of delta.changes) {
      if (change.sha === null) {
        const pt = timelines.get(change.path);
        if (pt) pt.deletedIdx = i;
        continue;
      }

      const lines = bundle.blobLines[change.sha] ?? 0;
      let pt = timelines.get(change.path);
      if (!pt) {
        pt = { changes: [], createdIdx: i, deletedIdx: null };
        timelines.set(change.path, pt);
      }
      pt.deletedIdx = null; // a re-add resurrects the path
      pt.changes.push({ i, lines });
    }
  });

  return timelines;
}

export function linesAt(pt: PathTimeline, pos: number): number {
  if (pos < pt.createdIdx || (pt.deletedIdx != null && pos >= pt.deletedIdx)) return 0;

  const { changes } = pt;
  if (changes.length === 0) return 0;
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

export function presenceAt(pt: PathTimeline, pos: number, ruinFloor: number): number {
  if (pos < pt.createdIdx) return 0;
  if (pt.deletedIdx != null && pos >= pt.deletedIdx) return ruinFloor;

  const rampT = pos - pt.createdIdx;
  if (rampT < PRESENCE_RAMP) return rampT / PRESENCE_RAMP;

  return 1;
}
