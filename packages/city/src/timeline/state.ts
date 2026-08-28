// city/timeline/state.ts — the history a city is showing and where in it you
// are: the mode, the loaded bundle, the scrub position, and the rest points
// derived from it. Per city, because the bundle is a repo's history and two
// cities on one page are two repos.
//
// Derived reads live beside the position they read: resetting the mode moves
// the position, so splitting them would make the two files cyclic.

import { epochDayAt, parseDateMs } from '@/city/utils/dates';
import {
  buildPathTimelines,
  blobShaAt,
  entryAt,
  statsAtDeletion,
  type PathTimeline,
} from './replay';
import type { TimelineBundle } from '@/city/types/timeline';

/** A file's measures at the scrub position, or at its deletion if already gone. */
export interface ScrubbedFileStats {
  /** Null when the blob was never fetched: unknown at this commit, not zero. */
  lines: number | null;
  bytes: number | null;
  /** True when these are the values the file had when it was deleted. */
  atDeletion: boolean;
}

/** What a subscriber can hear about. `position` covers the scrub and the rest
 *  points it settles on; `mode` covers entering and leaving. */
export type TimelineChange = 'mode' | 'bundle' | 'position';

export interface TimelineState {
  /** A distinct render mode: the union city, scrubbed. */
  readonly mode: boolean;
  readonly bundle: TimelineBundle | null;
  /** A float commit index, so scrubbing interpolates. Clamped to the loaded
   *  bundle on read, so a bundle swap alone cannot leave it out of range. */
  readonly pos: number;
  /** Highest valid index: one past the last commit when today is its own stop. */
  readonly max: number;
  /** The whole commit `pos` lands on, so anything keyed on presence recomputes
   *  once per crossing rather than once per frame. */
  readonly commit: number;
  /** Anything that would reflow the layout waits for this to clear, or the
   *  track resizes under the pointer mid-drag and the position jumps. */
  readonly dragging: boolean;
  /** The rest point content fetches key on: follows the scrub but holds still
   *  mid-drag, so dragging a long history does not refetch per commit crossed. */
  readonly settledCommit: number;
  /** The same rest point as a position. `settledCommit` caps at the newest
   *  commit, so it cannot tell that stop from the today stop past it; this can. */
  readonly settledPos: number;
  /** Today, when it is later than the last commit: the city goes on aging after
   *  the last thing anyone committed. Null when the newest commit is today. */
  readonly todayMs: number | null;
  /** Per-path replay, rebuilt when the bundle changes and never per scrub. */
  readonly timelines: Map<string, PathTimeline> | null;

  /** Enter the mode. Called BEFORE the union city is packed: the mode is what
   *  tells the renderer whose city to pack. The position follows its bundle. */
  enter(): void;
  /** The bundle this city is scrubbing. */
  setBundle(bundle: TimelineBundle | null): void;
  /** The only way to move the scrubber; `pos` being readonly makes bypassing
   *  it a type error. */
  setPosition(pos: number): void;
  /** The mode alone, leaving the loaded history in place: re-entering lands
   *  back on the bundle and position it left. */
  setMode(on: boolean): void;
  /** Every exit path: the toggle, a source switch, a teardown. The history
   *  goes with the mode. */
  exit(): void;
  /** The moment Timeline treats as now. Set on entry; tests pin it. */
  setTodayMs(ms: number): void;
  /** Whether a drag is in flight: anything that would reflow the layout waits
   *  for it to clear, or the track resizes under the pointer. */
  setDragging(on: boolean): void;
  /** Hear about one kind of change. Returns the unsubscribe. */
  on(kind: TimelineChange, listener: () => void): () => void;

  /** A file's measures at the settled commit, so the number always describes
   *  the blob the content fetch serves. Null outside Timeline. */
  scrubbedStatsFor(path: string): ScrubbedFileStats | null;
  /** Blob sha for a path at the settled commit; null in Live or when absent. */
  scrubbedBlobShaFor(path: string | null | undefined): string | null;
  /** No content to fetch here, so a caller must NOT fall back to a by-path
   *  read: that hits HEAD, where a union file may not exist (#122). */
  hasNoContentAtScrub(path: string | null | undefined): boolean;

  dispose(): void;
}

export function createTimelineState(): TimelineState {
  let mode = false;
  let bundle: TimelineBundle | null = null;
  let dragging = false;
  let rawPos = 0;
  let settledCommit = 0;
  let settledPos = 0;
  // Read once per entry rather than per frame: the stop today sits at has to
  // hold still while it is being scrubbed to.
  let todayAtEntry = Date.now();

  // Derived from the bundle, so recomputed when it changes and never per scrub.
  // Lazily: replaying a long history is expensive, and only the scrub and the
  // stat readers need it — a consumer that just wants the track length never
  // pays for it.
  let timelines: Map<string, PathTimeline> | null = null;
  let timelinesStale = true;
  let todayMs: number | null = null;
  let max = 0;

  const listeners = new Map<TimelineChange, Set<() => void>>();

  function on(kind: TimelineChange, listener: () => void): () => void {
    let set = listeners.get(kind);
    if (!set) {
      set = new Set();
      listeners.set(kind, set);
    }
    set.add(listener);
    return () => void set.delete(listener);
  }

  function _tell(kind: TimelineChange): void {
    for (const listener of [...(listeners.get(kind) ?? [])]) listener();
  }

  /** What the loaded history implies: the replay, and where the track ends. */
  function _timelines(): Map<string, PathTimeline> | null {
    if (timelinesStale) {
      timelines = bundle ? buildPathTimelines(bundle) : null;
      timelinesStale = false;
    }
    return timelines;
  }

  function _recomputeBundle(): void {
    timelinesStale = true;

    todayMs = null;
    if (bundle && bundle.commits.length > 0) {
      // Parsed the way the bar prints dates, so the stop lands on the day it
      // names. Whole days: a commit from this morning is not a stop away from
      // now, and a track ending hours past its last tick reads as a rounding
      // error.
      const newest = parseDateMs(bundle.commits[bundle.commits.length - 1].date);
      if (Number.isFinite(newest)) {
        todayMs =
          Math.floor(epochDayAt(todayAtEntry)) > Math.floor(epochDayAt(newest))
            ? todayAtEntry
            : null;
      }
    }
    max = Math.max(0, (bundle?.commits.length ?? 0) - 1) + (todayMs === null ? 0 : 1);
  }

  /** Clamped against the loaded bundle, so a bundle swap alone cannot leave the
   *  position out of range and readers never clamp defensively. */
  function pos(): number {
    return Math.min(Math.max(rawPos, 0), max);
  }

  function commit(): number {
    return Math.min(Math.floor(pos()), Math.max(0, (bundle?.commits.length ?? 0) - 1));
  }

  /** The rest point content fetches key on: follows the scrub but holds still
   *  mid-drag, so dragging a long history does not refetch per commit crossed. */
  function _settle(): void {
    if (dragging) return;
    settledCommit = commit();
    settledPos = pos();
  }

  function timelineFor(path: string | null | undefined): PathTimeline | undefined {
    if (!path || !mode) return undefined;
    return _timelines()?.get(path) ?? undefined;
  }

  function scrubbedBlobShaFor(path: string | null | undefined): string | null {
    const pt = timelineFor(path);
    // Settled, not live: content fetches wait for the drag to end.
    return pt ? blobShaAt(pt, settledCommit) : null;
  }

  return {
    get mode() {
      return mode;
    },
    get bundle() {
      return bundle;
    },
    get pos() {
      return pos();
    },
    get max() {
      return max;
    },
    get commit() {
      return commit();
    },
    get dragging() {
      return dragging;
    },
    get settledCommit() {
      return settledCommit;
    },
    get settledPos() {
      return settledPos;
    },
    get todayMs() {
      return todayMs;
    },
    get timelines() {
      return _timelines();
    },
    on,

    enter(): void {
      mode = true;
      todayAtEntry = Date.now();
      _recomputeBundle();
      _tell('mode');
    },
    setMode(on): void {
      if (mode === on) return;
      mode = on;
      _tell('mode');
    },
    setBundle(next): void {
      bundle = next;
      _recomputeBundle();
      _settle();
      _tell('bundle');
      _tell('position');
    },
    setPosition(next): void {
      if (rawPos === next) return;
      rawPos = next;
      _settle();
      _tell('position');
    },
    setDragging(on): void {
      if (dragging === on) return;
      dragging = on;
      // The drag ending is what lets the rest points catch up.
      _settle();
      _tell('position');
    },
    exit(): void {
      mode = false;
      rawPos = 0;
      bundle = null;
      dragging = false;
      _recomputeBundle();
      _settle();
      _tell('mode');
      _tell('bundle');
      _tell('position');
    },
    setTodayMs(ms): void {
      todayAtEntry = ms;
      _recomputeBundle();
    },

    scrubbedStatsFor(path): ScrubbedFileStats | null {
      const pt = timelineFor(path);
      if (!pt) return null;
      const gone = statsAtDeletion(pt, settledCommit);
      if (gone) return { lines: gone.lines, bytes: gone.bytes, atDeletion: true };
      const entry = entryAt(pt, settledCommit);
      return entry ? { lines: entry.lines, bytes: entry.bytes, atDeletion: false } : null;
    },
    scrubbedBlobShaFor,
    hasNoContentAtScrub(path): boolean {
      return mode && scrubbedBlobShaFor(path) === null;
    },

    dispose(): void {
      listeners.clear();
    },
  };
}
