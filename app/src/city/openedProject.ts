// city/openedProject.ts — the configuration that makes a city BE the project
// you opened: what it shows, whose readouts it drives, what it is a picture
// of, and the scrubber that owns it in Timeline. The city layer reads no
// store, so this is the one file naming those signals.

import { computed } from '@preact/signals';
import { MANIFEST } from '@/state/stores/manifest';
import { CURRENT_SOURCE_KEY } from '@/state/stores/source';
import { OPENED_PROJECT_REPORTER } from '@/state/stores/progress';
import { TIMELINE_MODE, SCRUB_POS, SCRUB_DRAGGING } from '@/state/stores/timeline';
import { SCENE_HANDLE } from '@/city/sceneHandle';
import { reapplyTimelineScene } from '@/hooks/useTimelineMode';
import { CameraMode } from '@/city/render/cameraRig';
import type { CityProps } from '@/city/City';
import type { Manifest } from '@/types';

/** MANIFEST, as the city layer takes it: the store's value spans the skeleton
 *  the stream emits before it is fully typed. */
const OPENED_MANIFEST = computed<Manifest | null>(() => MANIFEST.value as Manifest | null);

export const OPENED_PROJECT: CityProps = {
  source: OPENED_MANIFEST,
  cameraMode: CameraMode.Project,
  report: OPENED_PROJECT_REPORTER,
  subjectKey: () => CURRENT_SOURCE_KEY.peek(),
  timeline: {
    mode: TIMELINE_MODE,
    scrubPos: SCRUB_POS,
    scrubDragging: SCRUB_DRAGGING,
    liveManifest: () => MANIFEST.peek() as Manifest | null,
    repack: reapplyTimelineScene,
  },
  handle: SCENE_HANDLE,
};
