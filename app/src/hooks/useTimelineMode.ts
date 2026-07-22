// hooks/useTimelineMode.ts — enter/exit the explicit Timeline mode.
//
// Enter: fetch the history bundle, pack the union city ONCE, install the scrub
// controller (which owns each building's scaleY + iFade and its street's opacity
// per frame), and flip TIMELINE_MODE so the live poll + fader stand down. Exit:
// tear the controller down and reload live HEAD. Called by the header toggle.
// teardownTimelineMode only flips TIMELINE_MODE; the city-layer effect (city/index.ts) does the actual scene teardown for every exit path.

import { batch } from '@preact/signals';

import { fetchTimelineBundle } from '@/api/timeline';
import { buildPathTimelines } from '@/city/timeline/replay';
import { CURRENT_SOURCE } from '@/state/stores/source';
import { SCENE_HANDLE } from '@/state/stores/scene';
import { markError } from '@/state/stores/manifest';
import {
  showLoadingOverlay,
  setLoadingStep,
  setLoadingStepTail,
  hideLoadingOverlay,
} from '@/state/stores/ui';
import { LoadingStep, TIMELINE_LOADING_STEPS } from '@/constants/loadingSteps';
import { srcKind } from '@/utils/sources';
import {
  TIMELINE_MODE,
  SCRUB_POS,
  TIMELINE_BUNDLE,
  resetTimelineMode,
} from '@/state/stores/timeline';
import { loadSource } from '@/hooks/useManifestSource';
import type { Manifest, TimelineProgress } from '@/types';

/** Progress tail for the "Loading history" step: running commit count during
 *  the history walk, done/total during blob resolution. */
function timelineLoadingTail(p: TimelineProgress): string | null {
  if (p.stage === 'history') {
    return p.commits !== undefined ? `${p.commits.toLocaleString()} commits` : null;
  }
  if (p.blobsDone !== undefined && p.blobsTotal !== undefined) {
    return `${p.blobsDone}/${p.blobsTotal} files`;
  }
  return 'resolving files';
}

export async function enterTimelineMode(): Promise<void> {
  const cur = CURRENT_SOURCE.peek();
  if (!cur) return;
  const handle = SCENE_HANDLE.peek();
  if (!handle) return;

  // Full overlay, not the footer "rebuilding…" — this is a mode switch, not a
  // background refresh, so it deserves the same treatment as a cold load.
  showLoadingOverlay({ kind: srcKind(cur.src), branch: cur.branch, steps: TIMELINE_LOADING_STEPS });
  setLoadingStep(LoadingStep.TimelineLoading);
  try {
    const bundle = await fetchTimelineBundle(cur.src, cur.branch, (p) =>
      setLoadingStepTail(LoadingStep.TimelineLoading, timelineLoadingTail(p))
    );
    TIMELINE_BUNDLE.value = bundle;
    const timelines = buildPathTimelines(bundle);
    setLoadingStepTail(LoadingStep.TimelineLoading, null);
    setLoadingStep(LoadingStep.Building);
    // unionManifest is the generated Manifest; the packer reads it structurally.
    await handle.applyManifest(bundle.unionManifest as unknown as Manifest);
    // Flip after the pack: applyManifest rebuilds the street + footprint meshes opaque.
    handle.timeline.setStreetsTransparent(true);
    handle.timeline.setFootprintsTransparent(true);
    handle.timeline.installScrubController(timelines);
    batch(() => {
      TIMELINE_MODE.value = true;
      SCRUB_POS.value = Math.max(0, bundle.commits.length - 1); // start at present
    });
    // Hold the overlay through the union city's first painted frame, then reveal.
    requestAnimationFrame(() => hideLoadingOverlay());
  } catch (err) {
    // Leave nothing half-set: revert to live and surface via the footer.
    // Explicit handle calls too: a failure here may predate the controller install, so the effect wouldn't fire.
    resetTimelineMode();
    handle.timeline.uninstallScrubController();
    handle.timeline.setStreetsTransparent(false);
    handle.timeline.setFootprintsTransparent(false);
    markError(err);
    hideLoadingOverlay();
  }
}

// Scene-free: the city-layer effect (city/index.ts) reacts to TIMELINE_MODE and does the scene teardown.
export function teardownTimelineMode(): void {
  resetTimelineMode();
}

export function exitTimelineMode(): void {
  const cur = CURRENT_SOURCE.peek();
  teardownTimelineMode();
  if (cur) void loadSource({ src: cur.src, branch: cur.branch });
}
