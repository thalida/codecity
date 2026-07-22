// hooks/useTimelineMode.ts — enter/exit the explicit Timeline mode.
//
// Enter: fetch the history bundle, pack the union city ONCE, install the scrub
// controller (which owns each building's scaleY + iFade and its street's opacity
// per frame), and flip TIMELINE_MODE so the live poll + fader stand down. Exit:
// tear the controller down and reload live HEAD. Called by the header toggle.

import { batch } from '@preact/signals';

import { fetchTimelineBundle } from '@/api/timeline';
import { buildPathTimelines } from '@/city/timeline/replay';
import { CURRENT_SOURCE } from '@/state/stores/source';
import { SCENE_HANDLE } from '@/state/stores/scene';
import { markError } from '@/state/stores/manifest';
import { showLoadingOverlay, setLoadingStep, hideLoadingOverlay } from '@/state/stores/ui';
import { LoadingStep, TIMELINE_LOADING_STEPS } from '@/constants/loadingSteps';
import { srcKind } from '@/utils/sources';
import { TIMELINE_MODE, SCRUB_POS, TIMELINE_BUNDLE } from '@/state/stores/timeline';
import { loadSource } from '@/hooks/useManifestSource';
import type { Manifest } from '@/types';

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
    const bundle = await fetchTimelineBundle(cur.src, cur.branch);
    TIMELINE_BUNDLE.value = bundle;
    const timelines = buildPathTimelines(bundle);
    setLoadingStep(LoadingStep.Building);
    // unionManifest is the generated Manifest; the packer reads it structurally.
    await handle.applyManifest(bundle.unionManifest as unknown as Manifest);
    // Flip after the pack: applyManifest rebuilds the street meshes opaque.
    handle.timeline.setStreetsTransparent(true);
    handle.timeline.installScrubController(timelines);
    batch(() => {
      TIMELINE_MODE.value = true;
      SCRUB_POS.value = Math.max(0, bundle.commits.length - 1); // start at present
    });
    // Hold the overlay through the union city's first painted frame, then reveal.
    requestAnimationFrame(() => hideLoadingOverlay());
  } catch (err) {
    // Leave nothing half-set: revert to live and surface via the footer.
    TIMELINE_MODE.value = false;
    handle.timeline.uninstallScrubController();
    handle.timeline.setStreetsTransparent(false);
    markError(err);
    hideLoadingOverlay();
  }
}

export function exitTimelineMode(): void {
  const cur = CURRENT_SOURCE.peek();
  const handle = SCENE_HANDLE.peek();
  TIMELINE_MODE.value = false; // clears the poll + fader guards
  handle?.timeline.uninstallScrubController();
  handle?.timeline.setStreetsTransparent(false);
  if (cur) void loadSource({ src: cur.src, branch: cur.branch });
}
