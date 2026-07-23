import { signal, batch } from '@preact/signals';
import type { TimelineBundle } from '@/types';

// Distinct render mode (union city + scrub). SCRUB_POS is a float commit index so scrubbing interpolates.
export const TIMELINE_MODE = signal(false);
export const SCRUB_POS = signal(0);
export const TIMELINE_BUNDLE = signal<TimelineBundle | null>(null);

// True while the user is actively dragging the scrubber handle. Consumers that
// would reflow the layout mid-scrub (e.g. auto-closing the right sidebar when a
// selection is scrubbed away) defer until the drag ends, so the track can't
// resize under the pointer and jump the position.
export const SCRUB_DRAGGING = signal(false);

// Shared by every exit path (toggle-off, source switch); scene-free, the scene layer reacts to TIMELINE_MODE.
export function resetTimelineMode(): void {
  batch(() => {
    TIMELINE_MODE.value = false;
    SCRUB_POS.value = 0;
    TIMELINE_BUNDLE.value = null;
    SCRUB_DRAGGING.value = false;
  });
}
