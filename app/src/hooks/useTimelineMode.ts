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
import { CURRENT_SOURCE, SOURCE_INFO, PENDING_SOURCE_LABEL } from '@/state/stores/source';
import { SCENE_HANDLE } from '@/state/stores/scene';
import { markError } from '@/state/stores/manifest';
import {
  showLoadingOverlay,
  setLoadingStep,
  setLoadingStepTail,
  hideLoadingOverlay,
  setLoadingCancel,
} from '@/state/stores/ui';
import { LoadingStep, TIMELINE_LOADING_STEPS } from '@/constants/loadingSteps';
import { srcKind } from '@/utils/sources';
import {
  TIMELINE_MODE,
  SCRUB_POS,
  TIMELINE_BUNDLE,
  resetTimelineMode,
} from '@/state/stores/timeline';
import { loadSource, cancelLoad } from '@/hooks/useManifestSource';
import type { Manifest, TimelineProgress } from '@/types';

/** Progress tail for the "Loading history" step: download % while backfilling a
 *  blobless clone, commit count during the history walk, done/total during blob
 *  resolution. */
function timelineLoadingTail(p: TimelineProgress): string | null {
  if (p.stage === 'fetch') {
    return p.percent != null ? `downloading ${p.percent}%` : 'downloading history';
  }
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
  // background refresh, so it deserves the same treatment as a cold load, repo
  // name header included (PENDING_SOURCE_LABEL, the same signal the live load sets).
  PENDING_SOURCE_LABEL.value = SOURCE_INFO.peek().label || null;

  // Cancel handler for the overlay: abort the history fetch (the long part) and
  // stay on the live city — nothing is touched until the pack below (committed).
  const abort = new AbortController();
  let cancelled = false;
  let committed = false;
  showLoadingOverlay(
    { kind: srcKind(cur.src), branch: cur.branch, steps: TIMELINE_LOADING_STEPS },
    () => {
      if (committed) return;
      cancelled = true;
      abort.abort();
      hideLoadingOverlay();
      PENDING_SOURCE_LABEL.value = null;
    }
  );
  setLoadingStep(LoadingStep.TimelineLoading);
  try {
    const bundle = await fetchTimelineBundle(
      cur.src,
      cur.branch,
      (p) => setLoadingStepTail(LoadingStep.TimelineLoading, timelineLoadingTail(p)),
      { signal: abort.signal }
    );
    if (cancelled) return; // user backed out during the fetch — live view stands
    committed = true; // past here the scene is repacked; no longer cancellable
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
    requestAnimationFrame(() => {
      hideLoadingOverlay();
      PENDING_SOURCE_LABEL.value = null;
    });
  } catch (err) {
    if (cancelled) return; // user cancel already aborted the fetch + restored live
    // Leave nothing half-set: revert to live and surface via the footer.
    // Explicit handle calls too: a failure here may predate the controller install, so the effect wouldn't fire.
    // Cleanup is best-effort — swallow its own throw so it can't bury `err` or strand the overlay (a silent stuck load).
    try {
      resetTimelineMode();
      handle.timeline.uninstallScrubController();
      handle.timeline.setStreetsTransparent(false);
      handle.timeline.setFootprintsTransparent(false);
    } catch {
      /* teardown failed; surfacing err + hiding the overlay below is what matters */
    }
    markError(err);
    hideLoadingOverlay();
    PENDING_SOURCE_LABEL.value = null;
  }
}

// Enter Timeline mode if it isn't already on, then scrub to the given commit.
// Called by the commit pane's "view in timeline" button — in Live mode it enters
// first, in Timeline mode it just jumps. No-op if the sha isn't in the bundle
// (e.g. a commit the union cap dropped) or the mode failed to engage.
export async function viewCommitInTimeline(sha: string): Promise<void> {
  if (!TIMELINE_MODE.peek()) {
    await enterTimelineMode();
    if (!TIMELINE_MODE.peek()) return; // enter failed; the error is surfaced already
  }
  const bundle = TIMELINE_BUNDLE.peek();
  if (!bundle) return;
  const idx = bundle.commits.findIndex((c) => c.sha === sha);
  if (idx >= 0) SCRUB_POS.value = idx;
}

// Scene-free: the city-layer effect (city/index.ts) reacts to TIMELINE_MODE and does the scene teardown.
export function teardownTimelineMode(): void {
  resetTimelineMode();
}

export function exitTimelineMode(): void {
  const cur = CURRENT_SOURCE.peek();
  const scrubPos = SCRUB_POS.peek(); // remember where the scrubber was
  teardownTimelineMode();
  if (!cur) return;
  // Reloading live HEAD behind the overlay. Cancelling it re-enters Timeline
  // where you were (the bundle is warm-cached) rather than dumping you on the
  // project switcher. Registered before loadSource so its reaction's overlay
  // (shown without a cancel) leaves this in place.
  setLoadingCancel(() => {
    cancelLoad();
    void enterTimelineMode().then(() => {
      if (TIMELINE_MODE.peek()) SCRUB_POS.value = scrubPos;
    });
  });
  void loadSource({ src: cur.src, branch: cur.branch });
}
