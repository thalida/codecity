// hooks/useTimelineMode.ts — enter/exit the explicit Timeline mode.
//
// Enter: fetch the history bundle, pack the union city ONCE, install the scrub
// controller (which owns each building's scaleY + iFade and its street's opacity
// per frame), and flip TIMELINE_MODE so the live poll + fader stand down. Exit:
// tear the controller down and reload live HEAD. Called by the header toggle.
// teardownTimelineMode only flips TIMELINE_MODE; the city-layer effect (city/index.ts) does the actual scene teardown for every exit path.

import { fetchTimelineBundle } from '@/api/timeline';
import { buildPathTimelines } from '@/city/timeline/replay';
import { CURRENT_SOURCE, SOURCE_INFO } from '@/state/stores/source';
import { SCENE_HANDLE } from '@/state/stores/scene';
import { markError, markRebuilding } from '@/state/stores/manifest';
import {
  showLoadingOverlay,
  setLoadingStep,
  setLoadingStepTail,
  hideLoadingOverlay,
  setLoadingCancel,
  PENDING_SOURCE_LABEL,
} from '@/state/stores/ui';
import { LoadingStep, TIMELINE_LOADING_STEPS } from '@/constants/loadingSteps';
import { srcKind } from '@/utils/sources';
import {
  TIMELINE_MODE,
  TIMELINE_BUNDLE,
  SCRUB_POS,
  resetTimelineMode,
  enterTimelineMode,
  setScrubPos,
} from '@/state/stores/timeline';
import { loadSource, cancelLoad, setTimelineRefreshHandler } from '@/hooks/useManifestSource';
import { activeExcludePathsFor } from '@/state/stores/excludes';
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

// Fetch the union bundle for the current source + excludes, pack the union city,
// and install the scrub controller. Two modes:
//   - fresh enter (from Live): full overlay + cancel-back-to-Live, scrub at present.
//   - inPlace (already in Timeline — an exclude edit changed the union DATA, so the
//     warm bundle is stale and must be refetched): footer "rebuilding" instead of the
//     overlay, hold the scrub position, and stay in Timeline on error (no Live scene
//     to fall back to). Settings changes don't come here — they re-pack the warm
//     bundle via reapplyTimelineScene with no refetch.
export async function loadTimelineScene({ inPlace = false } = {}): Promise<void> {
  const cur = CURRENT_SOURCE.peek();
  if (!cur) return;
  const handle = SCENE_HANDLE.peek();
  if (!handle) return;

  const abort = new AbortController();
  let cancelled = false;
  let committed = false;

  if (inPlace) {
    markRebuilding(); // footer status; the trees decoration pass clears it after the pack
  } else {
    // Full overlay, repo-name header included (PENDING_SOURCE_LABEL, the same signal
    // the live load sets), with a cancel that aborts the history fetch and stays on
    // the live city — nothing is touched until the pack below (committed).
    PENDING_SOURCE_LABEL.value = SOURCE_INFO.peek().label || null;
    showLoadingOverlay(
      { kind: srcKind(cur.src), branch: cur.branch, steps: TIMELINE_LOADING_STEPS },
      () => {
        if (committed) return;
        cancelled = true;
        abort.abort();
        hideLoadingOverlay();
      }
    );
    setLoadingStep(LoadingStep.TimelineLoading);
  }

  try {
    const bundle = await fetchTimelineBundle(
      cur.src,
      cur.branch,
      inPlace
        ? undefined
        : (p) => setLoadingStepTail(LoadingStep.TimelineLoading, timelineLoadingTail(p)),
      { signal: abort.signal, exclude: activeExcludePathsFor(cur.src) }
    );
    if (cancelled) return; // user backed out during the fetch — live view stands
    committed = true; // past here the scene is repacked; no longer cancellable
    TIMELINE_BUNDLE.value = bundle;
    const timelines = buildPathTimelines(bundle);
    if (!inPlace) {
      setLoadingStepTail(LoadingStep.TimelineLoading, null);
      setLoadingStep(LoadingStep.Building);
    }
    // unionManifest is the generated Manifest; the packer reads it structurally.
    await handle.applyManifest(bundle.unionManifest as unknown as Manifest);
    // Flip after the pack: applyManifest rebuilds the street + footprint meshes opaque.
    handle.timeline.setStreetsTransparent(true);
    handle.timeline.setFootprintsTransparent(true);
    handle.timeline.installScrubController(timelines, bundle.commitLineRanges);
    // An in-place refetch holds position (self-clamping if the bundle shrank);
    // a fresh enter starts at the present.
    enterTimelineMode(inPlace ? SCRUB_POS.peek() : undefined);
    if (!inPlace) {
      // Hold the overlay through the union city's first painted frame, then reveal.
      requestAnimationFrame(() => {
        hideLoadingOverlay();
      });
    }
  } catch (err) {
    if (cancelled) return; // user cancel already aborted the fetch + restored live
    // Fresh enter reverts to live and tears the half-set scene down (a failure may
    // predate the controller install, so the effect wouldn't fire); best-effort so
    // its own throw can't bury `err`. An in-place refetch stays in Timeline.
    if (!inPlace) {
      try {
        resetTimelineMode();
        handle.timeline.uninstallScrubController();
        handle.timeline.setStreetsTransparent(false);
        handle.timeline.setFootprintsTransparent(false);
      } catch {
        /* teardown failed; surfacing err + hiding the overlay below is what matters */
      }
      hideLoadingOverlay();
    }
    markError(err);
  }
}

// An excludes change while Timeline is active must refetch the bundle rather
// than re-scan HEAD. useManifestSource is the lower layer and cannot import this
// module (that was a cycle), so hand it the callback here. Registering at module
// scope is safe: TIMELINE_MODE only turns on via loadTimelineScene above, so this
// has always run by the time the handler can be reached.
setTimelineRefreshHandler(() => loadTimelineScene({ inPlace: true }));

// Enter Timeline mode if it isn't already on, then scrub to the given commit.
// Called by the commit pane's "view in timeline" button — in Live mode it enters
// first, in Timeline mode it just jumps. No-op if the sha isn't in the bundle
// (e.g. a commit the union cap dropped) or the mode failed to engage.
export async function viewCommitInTimeline(sha: string): Promise<void> {
  if (!TIMELINE_MODE.peek()) {
    await loadTimelineScene();
    if (!TIMELINE_MODE.peek()) return; // enter failed; the error is surfaced already
  }
  const bundle = TIMELINE_BUNDLE.peek();
  if (!bundle) return;
  const idx = bundle.commits.findIndex((c) => c.sha === sha);
  if (idx >= 0) setScrubPos(idx);
}

// Re-pack the union city + re-install the scrub controller from the warm bundle
// (no re-fetch), holding SCRUB_POS — so a Timeline-mode settings Save stays in
// Timeline instead of dropping to live HEAD.
export async function reapplyTimelineScene(): Promise<void> {
  const handle = SCENE_HANDLE.peek();
  const bundle = TIMELINE_BUNDLE.peek();
  if (!handle || !bundle) return;
  const timelines = buildPathTimelines(bundle);
  await handle.applyManifest(bundle.unionManifest as unknown as Manifest);
  handle.timeline.setStreetsTransparent(true);
  handle.timeline.setFootprintsTransparent(true);
  handle.timeline.installScrubController(timelines, bundle.commitLineRanges);
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
    void loadTimelineScene().then(() => {
      if (TIMELINE_MODE.peek()) setScrubPos(scrubPos);
    });
  });
  void loadSource({ src: cur.src, branch: cur.branch });
}
