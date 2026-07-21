import { signal } from '@preact/signals';
import type { TimelineBundle } from '@/types';

// Distinct render mode (union city + scrub). SCRUB_POS is a float commit index so scrubbing interpolates.
export const TIMELINE_MODE = signal(false);
export const SCRUB_POS = signal(0);
export const TIMELINE_BUNDLE = signal<TimelineBundle | null>(null);
