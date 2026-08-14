// hooks/useTimelineMode.ts — enter/exit the explicit Timeline mode. Enter packs
// the union city once and installs the scrub controller; exit reloads live HEAD.
// Every exit path only flips TIMELINE_MODE: the city layer (city/index.ts)
// reacts to that and does the scene teardown itself.

import { fetchTimelineBundle } from '@/api/timeline';
import { buildPathTimelines } from '@/city/timeline/replay';
import { CURRENT_SOURCE, SOURCE_INFO } from '@/state/stores/source';
import { SCENE_HANDLE } from '@/state/stores/scene';
import { markError, markRebuilding, setRebuildDetail } from '@/state/stores/manifest';
import {
  showLoadingOverlay,
  setLoadingStep,
  setLoadingStepTail,
  hideLoadingOverlay,
  setLoadingCancel,
  PENDING_SOURCE_LABEL,
} from '@/state/stores/ui';
import {
  LoadingStep,
  TIMELINE_LOADING_STEPS,
  stepForTimelineStage,
} from '@/constants/loadingSteps';
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

/** How far the current stage has got. Written beside its own step row, and
 *  standalone beside the freshness dot, so it names its own units. */
function timelineStageTail(p: TimelineProgress): string | null {
  if (p.stage === 'fetch') return p.percent != null ? `${p.percent}%` : null;
  if (p.stage === 'history') {
    return p.commits !== undefined ? `${p.commits.toLocaleString()} commits` : null;
  }
  if (p.blobsDone !== undefined && p.blobsTotal !== undefined) {
    return `${p.blobsDone}/${p.blobsTotal} files`;
  }
  return null;
}

// `inPlace` is the already-in-Timeline refetch: it holds the scrub and stays in
// Timeline on error. `overlay` is whether it takes the screen while it runs.
export async function loadTimelineScene({
  inPlace = false,
  noCache = false,
  overlay = !inPlace,
} = {}): Promise<void> {
  const cur = CURRENT_SOURCE.peek();
  if (!cur) return;
  const handle = SCENE_HANDLE.peek();
  if (!handle) return;

  const abort = new AbortController();
  let cancelled = false;
  let committed = false;

  // Unoverlaid, the readout is the only progress surface: say so now, and the
  // stage tails land beside it. Overlaid, a cancel has nothing to unwind.
  if (inPlace && !overlay) markRebuilding();
  if (overlay) {
    // Cancelling keeps whatever is on screen: nothing is touched until the pack
    // below sets `committed`.
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
  }

  // One row per server stage, so a stall is attributable to the stage it is in
  // and the rows below say what is still to come.
  const onProgress = (p: TimelineProgress): void => {
    const tail = timelineStageTail(p);
    if (!overlay) {
      setRebuildDetail(tail);
      return;
    }
    const step = stepForTimelineStage(p.stage);
    setLoadingStep(step);
    setLoadingStepTail(step, tail);
  };

  try {
    const bundle = await fetchTimelineBundle(cur.src, cur.branch, onProgress, {
      signal: abort.signal,
      exclude: activeExcludePathsFor(cur.src),
      noCache,
    });
    if (cancelled) return; // user backed out during the fetch — live view stands
    committed = true; // past here the scene is repacked; no longer cancellable
    TIMELINE_BUNDLE.value = bundle;
    const timelines = buildPathTimelines(bundle);
    if (overlay) setLoadingStep(LoadingStep.Building);
    // unionManifest is the generated Manifest; the packer reads it structurally.
    await handle.applyManifest(bundle.unionManifest as unknown as Manifest);
    // Flip after the pack: applyManifest rebuilds the street + footprint meshes opaque.
    handle.timeline.setStreetsTransparent(true);
    handle.timeline.setFootprintsTransparent(true);
    handle.timeline.installScrubController(timelines, bundle.commitLineRanges);
    // An in-place refetch holds position (self-clamping if the bundle shrank);
    // a fresh enter starts at the present.
    enterTimelineMode(inPlace ? SCRUB_POS.peek() : undefined);
    if (overlay) {
      // Hold the overlay through the union city's first painted frame, then reveal.
      requestAnimationFrame(() => {
        hideLoadingOverlay();
      });
    }
  } catch (err) {
    if (cancelled) return; // user cancel already aborted the fetch + restored live
    // A failure can predate the controller install, so the effect wouldn't
    // fire: tear down here, best-effort so its own throw can't bury `err`.
    if (!inPlace) {
      try {
        resetTimelineMode();
        handle.timeline.uninstallScrubController();
        handle.timeline.setStreetsTransparent(false);
        handle.timeline.setFootprintsTransparent(false);
      } catch {
        /* teardown failed; surfacing err + hiding the overlay below is what matters */
      }
    }
    if (overlay) hideLoadingOverlay();
    markError(err);
  }
}

// A refresh in Timeline → refetch the bundle, not a HEAD re-scan. A callback
// because a direct import was a cycle; registered before the mode can turn on.
setTimelineRefreshHandler((opts) => loadTimelineScene({ inPlace: true, ...opts }));

// Enter Timeline if it isn't on, then scrub to the commit. No-op if the sha
// isn't in the bundle (the union cap can drop one) or the mode failed to engage.
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

// Re-pack from the warm bundle, holding SCRUB_POS, so a settings Save in
// Timeline stays in Timeline instead of dropping to live HEAD.
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
  // Cancelling the reload re-enters Timeline where you were rather than dumping
  // you on the switcher. Registered first, so loadSource's overlay keeps it.
  setLoadingCancel(() => {
    cancelLoad();
    void loadTimelineScene().then(() => {
      if (TIMELINE_MODE.peek()) setScrubPos(scrubPos);
    });
  });
  void loadSource({ src: cur.src, branch: cur.branch });
}
