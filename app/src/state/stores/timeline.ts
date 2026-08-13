import { signal, batch, computed, effect, type ReadonlySignal } from '@preact/signals';
import type { TimelineBundle } from '@/types';
import { parseDateMs, epochDayAt } from '@/utils/dates';

// Distinct render mode (union city + scrub). SCRUB_POS is a float commit index so scrubbing interpolates.
export const TIMELINE_MODE = signal(false);
export const TIMELINE_BUNDLE = signal<TimelineBundle | null>(null);

/** How many commits the loaded bundle holds. */
const COMMIT_COUNT = computed(() => TIMELINE_BUNDLE.value?.commits.length ?? 0);

/** Read once per Timeline entry rather than per frame: the stop today sits at
 *  has to hold still while it is being scrubbed to. */
const _todayMs = signal(Date.now());

/** Today, when it is later than the last commit: the city goes on aging after
 *  the last thing anyone committed, so the track runs to now rather than
 *  stopping at a commit and pretending nothing has happened since. Null when
 *  the newest commit is today (or later, on a skewed clock). */
export const SCRUB_TODAY_MS = computed(() => {
  const bundle = TIMELINE_BUNDLE.value;
  if (!bundle || bundle.commits.length === 0) return null;
  // Parsed the way the bar prints dates, so the stop lands on the day it names.
  const newest = parseDateMs(bundle.commits[bundle.commits.length - 1].date);
  const today = _todayMs.value;
  if (!Number.isFinite(newest)) return null;
  // Whole days: a commit from this morning is not a stop away from this
  // afternoon, and a track that ends a few hours past its last tick reads as
  // a rounding error rather than as today.
  return Math.floor(epochDayAt(today)) > Math.floor(epochDayAt(newest)) ? today : null;
});

/** The moment Timeline treats as now. Set on entry; tests pin it. */
export function setTodayMs(ms: number): void {
  _todayMs.value = ms;
}

/** Highest valid scrub index for the loaded bundle, 0 when there is none. One
 *  past the last commit when today is a stop of its own. */
export const SCRUB_MAX = computed(
  () => Math.max(0, COMMIT_COUNT.value - 1) + (SCRUB_TODAY_MS.value === null ? 0 : 1)
);

const _scrubPos = signal(0);

// Clamped against the current bundle, not at each write, so a bundle swap alone
// can't leave a stale position out of range. Readers never clamp defensively.
export const SCRUB_POS: ReadonlySignal<number> = computed(() =>
  Math.min(Math.max(_scrubPos.value, 0), SCRUB_MAX.value)
);

/** The only way to move the scrubber; readonly SCRUB_POS makes that a type error to bypass. */
export function setScrubPos(pos: number): void {
  _scrubPos.value = pos;
}

// The whole commit index SCRUB_POS lands on. Per-path presence only changes at
// integer commits, so the sidebar's present-path filter (keyed on this) recomputes
// once per commit crossing, not on every sub-commit interpolation frame. Capped
// at the last commit: past it the city is still that commit's, only older.
export const SCRUB_COMMIT = computed(() =>
  Math.min(Math.floor(SCRUB_POS.value), Math.max(0, COMMIT_COUNT.value - 1))
);

// True while the user is actively dragging the scrubber handle. Consumers that
// would reflow the layout mid-scrub (e.g. auto-closing the right sidebar when a
// selection is scrubbed away) defer until the drag ends, so the track can't
// resize under the pointer and jump the position.
export const SCRUB_DRAGGING = signal(false);

// The commit content fetches key on: follows the scrub but holds still mid-drag,
// so dragging across a long history doesn't refetch once per commit crossed.
export const SETTLED_COMMIT = signal(0);
effect(() => {
  const commit = SCRUB_COMMIT.value;
  if (!SCRUB_DRAGGING.value) SETTLED_COMMIT.value = commit;
});

// Every entry path, called only once the union city is packed: flipping the mode
// before that leaves Timeline pointed at live geometry. `pos` defaults to the present.
export function enterTimelineMode(pos?: number): void {
  batch(() => {
    TIMELINE_MODE.value = true;
    _todayMs.value = Date.now();
    setScrubPos(pos ?? SCRUB_MAX.peek());
  });
}

// Shared by every exit path (toggle-off, source switch); scene-free, the scene layer reacts to TIMELINE_MODE.
export function resetTimelineMode(): void {
  batch(() => {
    TIMELINE_MODE.value = false;
    setScrubPos(0);
    TIMELINE_BUNDLE.value = null;
    SCRUB_DRAGGING.value = false;
  });
}
