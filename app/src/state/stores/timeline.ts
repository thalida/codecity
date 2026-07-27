import { signal, batch, computed, effect, type ReadonlySignal } from '@preact/signals';
import type { TimelineBundle } from '@/types';

// Distinct render mode (union city + scrub). SCRUB_POS is a float commit index so scrubbing interpolates.
export const TIMELINE_MODE = signal(false);
export const TIMELINE_BUNDLE = signal<TimelineBundle | null>(null);

/** Highest valid scrub index for the loaded bundle, 0 when there is none. */
export const SCRUB_MAX = computed(() =>
  Math.max(0, (TIMELINE_BUNDLE.value?.commits.length ?? 0) - 1)
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
// once per commit crossing, not on every sub-commit interpolation frame.
export const SCRUB_COMMIT = computed(() => Math.floor(SCRUB_POS.value));

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

// Shared by every exit path (toggle-off, source switch); scene-free, the scene layer reacts to TIMELINE_MODE.
export function resetTimelineMode(): void {
  batch(() => {
    TIMELINE_MODE.value = false;
    setScrubPos(0);
    TIMELINE_BUNDLE.value = null;
    SCRUB_DRAGGING.value = false;
  });
}
