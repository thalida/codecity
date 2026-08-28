// city/timeline/state.ts — the history a city is showing and where in it you
// are: the mode, the loaded bundle, the scrub position, and the rest points
// derived from it. Per city, because the bundle is a repo's history and two
// cities on one page are two repos.
//
// Derived reads live beside the position they read: resetting the mode moves
// the position, so splitting them would make the two files cyclic.

import { signal, batch, computed, effect, type ReadonlySignal, type Signal } from '@preact/signals';

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

export interface TimelineState {
  /** A distinct render mode: the union city, scrubbed. */
  readonly mode: ReadonlySignal<boolean>;
  readonly bundle: ReadonlySignal<TimelineBundle | null>;
  /** A float commit index, so scrubbing interpolates. Clamped to the loaded
   *  bundle on read, so a bundle swap alone cannot leave it out of range. */
  readonly pos: ReadonlySignal<number>;
  /** Highest valid index: one past the last commit when today is its own stop. */
  readonly max: ReadonlySignal<number>;
  /** The whole commit `pos` lands on, so anything keyed on presence recomputes
   *  once per crossing rather than once per frame. */
  readonly commit: ReadonlySignal<number>;
  /** Anything that would reflow the layout waits for this to clear, or the
   *  track resizes under the pointer mid-drag and the position jumps. */
  readonly dragging: Signal<boolean>;
  /** The rest point content fetches key on: follows the scrub but holds still
   *  mid-drag, so dragging a long history does not refetch per commit crossed. */
  readonly settledCommit: ReadonlySignal<number>;
  /** The same rest point as a position. `settledCommit` caps at the newest
   *  commit, so it cannot tell that stop from the today stop past it; this can. */
  readonly settledPos: ReadonlySignal<number>;
  /** Today, when it is later than the last commit: the city goes on aging after
   *  the last thing anyone committed. Null when the newest commit is today. */
  readonly todayMs: ReadonlySignal<number | null>;
  /** Per-path replay, rebuilt when the bundle changes and never per scrub. */
  readonly timelines: ReadonlySignal<Map<string, PathTimeline> | null>;

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
  const mode = signal(false);
  const bundle = signal<TimelineBundle | null>(null);
  const dragging = signal(false);
  // Read once per entry rather than per frame: the stop today sits at has to
  // hold still while it is being scrubbed to.
  const todayAtEntry = signal(Date.now());

  const commitCount = computed(() => bundle.value?.commits.length ?? 0);

  const todayMs = computed<number | null>(() => {
    const b = bundle.value;
    if (!b || b.commits.length === 0) return null;
    // Parsed the way the bar prints dates, so the stop lands on the day it names.
    const newest = parseDateMs(b.commits[b.commits.length - 1].date);
    if (!Number.isFinite(newest)) return null;
    // Whole days: a commit from this morning is not a stop away from now, and a
    // track ending hours past its last tick reads as a rounding error.
    const today = todayAtEntry.value;
    return Math.floor(epochDayAt(today)) > Math.floor(epochDayAt(newest)) ? today : null;
  });

  const max = computed(() => Math.max(0, commitCount.value - 1) + (todayMs.value === null ? 0 : 1));

  const rawPos = signal(0);
  const pos = computed(() => Math.min(Math.max(rawPos.value, 0), max.value));
  const commit = computed(() =>
    Math.min(Math.floor(pos.value), Math.max(0, commitCount.value - 1))
  );

  const settledCommit = signal(0);
  const settledPos = signal(0);
  const stopSettle = effect(() => {
    const c = commit.value;
    const p = pos.value;
    if (dragging.value) return;
    batch(() => {
      settledCommit.value = c;
      settledPos.value = p;
    });
  });

  const timelines = computed<Map<string, PathTimeline> | null>(() => {
    const b = bundle.value;
    return b ? buildPathTimelines(b) : null;
  });

  function timelineFor(path: string | null | undefined): PathTimeline | undefined {
    if (!path || !mode.value) return undefined;
    return timelines.value?.get(path) ?? undefined;
  }

  function scrubbedBlobShaFor(path: string | null | undefined): string | null {
    const pt = timelineFor(path);
    // Settled, not live: content fetches wait for the drag to end.
    return pt ? blobShaAt(pt, settledCommit.value) : null;
  }

  return {
    mode,
    bundle,
    pos,
    max,
    commit,
    dragging,
    settledCommit,
    settledPos,
    todayMs,
    timelines,

    enter(): void {
      batch(() => {
        mode.value = true;
        todayAtEntry.value = Date.now();
      });
    },
    setBundle(next): void {
      bundle.value = next;
    },
    setPosition(next): void {
      rawPos.value = next;
    },
    setMode(on): void {
      mode.value = on;
    },
    exit(): void {
      batch(() => {
        mode.value = false;
        rawPos.value = 0;
        bundle.value = null;
        dragging.value = false;
      });
    },
    setTodayMs(ms): void {
      todayAtEntry.value = ms;
    },

    scrubbedStatsFor(path): ScrubbedFileStats | null {
      const pt = timelineFor(path);
      if (!pt) return null;
      const at = settledCommit.value;
      const gone = statsAtDeletion(pt, at);
      if (gone) return { lines: gone.lines, bytes: gone.bytes, atDeletion: true };
      const entry = entryAt(pt, at);
      return entry ? { lines: entry.lines, bytes: entry.bytes, atDeletion: false } : null;
    },
    scrubbedBlobShaFor,
    hasNoContentAtScrub(path): boolean {
      return mode.value && scrubbedBlobShaFor(path) === null;
    },

    dispose(): void {
      stopSettle();
    },
  };
}
