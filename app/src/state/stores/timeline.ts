import { signal, batch } from '@preact/signals';
import type { TimelineBundle } from '@/types';

// Distinct render mode (union city + scrub). SCRUB_POS is a float commit index so scrubbing interpolates.
export const TIMELINE_MODE = signal(false);
export const SCRUB_POS = signal(0);
export const TIMELINE_BUNDLE = signal<TimelineBundle | null>(null);
// Ghost-ruins: deleted buildings persist as a broken gray stub instead of vanishing. Toggle on the time-travel bar; on by default.
export const RUINS_ENABLED = signal(true);

// Shared by every exit path (toggle-off, source switch); scene-free, the scene layer reacts to TIMELINE_MODE.
export function resetTimelineMode(): void {
  batch(() => {
    TIMELINE_MODE.value = false;
    SCRUB_POS.value = 0;
    TIMELINE_BUNDLE.value = null;
  });
}
