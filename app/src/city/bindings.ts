// city/bindings.ts — the seam between a city and the app around it. The city
// layer reads no store; this is the one file that says which signals stand for
// "the project you opened", so a second city can be mounted beside it and
// neither one can hear the other.

import { MANIFEST } from '@/state/stores/manifest';
import { CURRENT_SOURCE_KEY } from '@/state/stores/source';
import { WORLD_BUILD_REPORTER } from '@/state/stores/progress';
import { TIMELINE_MODE, SCRUB_POS, SCRUB_DRAGGING } from '@/state/stores/timeline';
import type { CityBindings } from './types';
import type { Manifest } from '@/types';

/** The city on `/city`: the one whose build every readout describes, whose
 *  subject is the opened project, and the only one anything scrubs. */
export const WORLD_BINDINGS: CityBindings = {
  report: WORLD_BUILD_REPORTER,
  subjectKey: () => CURRENT_SOURCE_KEY.peek(),
  timeline: {
    mode: TIMELINE_MODE,
    scrubPos: SCRUB_POS,
    scrubDragging: SCRUB_DRAGGING,
    liveManifest: () => MANIFEST.peek() as Manifest | null,
  },
};

/** The landing's wallpaper: nobody waits for it, nobody scrubs it, and it
 *  paints one repo per visit, so it frames itself once and reports nothing. */
export const SCENERY_BINDINGS: CityBindings = {};
