// hooks/useTimelineMode.ts — enter/exit the explicit Timeline mode. Enter packs
// the union city once and installs the scrub controller; exit reloads live HEAD.
// Every exit path only flips TIMELINE_MODE: the city layer (city/index.ts)
// reacts to that and does the scene teardown itself.

import { Manifest, TimelineProgress, TimelineStage } from '@codecity/city';
import {
  CURRENT_SOURCE,
  SOURCE_INFO,
  RECENTS,
  commitSource,
  activeExcludePathsFor,
} from '@/state/stores/source';
import { SCENE_HANDLE, whenSceneHandle } from '@/state/stores/city';
import {
  failHostWork,
  beginHostWork,
  setRebuildDetail,
  showLoadingOverlay,
  setLoadingStep,
  setLoadingStepTail,
  hideLoadingOverlay,
  PENDING_SOURCE_LABEL,
} from '@/state/stores/progress';
import {
  LoadingStep,
  TIMELINE_LOADING_STEPS,
  stepForTimelineStage,
  transferTail,
} from '@/constants/progress';
import { srcKind } from '@codecity/city';
import { setTimelineBundle, resetTimelineMode } from '@/state/stores/timeline';
import { setTimelineRefreshHandler } from '@/hooks/useManifestSource';

/** How far the current stage has got. Written beside its own step row, and
 *  standalone beside the freshness dot, so it names its own units. */
function timelineStageTail(p: TimelineProgress): string | null {
  if (p.stage === TimelineStage.Fetch) return transferTail(p);
  if (p.stage === TimelineStage.History) {
    return p.commits !== undefined ? `${p.commits.toLocaleString()} commits` : null;
  }
  if (p.blobsDone !== undefined && p.blobsTotal !== undefined) {
    return `${p.blobsDone}/${p.blobsTotal} files`;
  }
  return null;
}

/** Load a source in Timeline: its own call and manifest, committed the way Live
 *  commits its scan. `inPlace` is the refetch that holds the scrub. */
export async function loadTimelineSource({
  src,
  branch,
  commit,
  inPlace = false,
  noCache = false,
  overlay = !inPlace,
}: {
  src: string;
  branch?: string;
  commit?: string;
  inPlace?: boolean;
  noCache?: boolean;
  overlay?: boolean;
}): Promise<void> {
  let cancelled = false;
  let committed = false;

  // Unoverlaid, the readout is the only progress surface: say so now, and the
  // stage tails land beside it. Overlaid, a cancel has nothing to unwind.
  if (inPlace && !overlay) beginHostWork();
  if (overlay) {
    // Cancelling keeps whatever is on screen: nothing is touched until the pack
    // below sets `committed`.
    PENDING_SOURCE_LABEL.value =
      SOURCE_INFO.peek().label || RECENTS.peek().find((r) => r.src === src)?.label || null;
    showLoadingOverlay({ kind: srcKind(src), branch, steps: TIMELINE_LOADING_STEPS }, () => {
      if (committed) return;
      cancelled = true;
      // The city owns the request, so it owns the abort. Read the published
      // handle rather than the one below, which is not initialised yet when a
      // cancel arrives during the wait for it.
      SCENE_HANDLE.peek()?.cancelTimelineLoad();
      hideLoadingOverlay();
    });
  }

  // A cold boot can outrun the city it packs into; a refetch can't, so no handle
  // there means nothing to refetch and waiting would hang the overlay.
  if (inPlace && !SCENE_HANDLE.peek()) return;
  const handle = await whenSceneHandle();
  if (cancelled) return;

  // One row per server stage, so a stall is attributable to the stage it is in
  // and the rows below say what is still to come. The percent inside the
  // Building row is the CITY's now (city.status.fraction), so the app no longer
  // mirrors a plan of its own alongside it.
  // The city reports the assembly like any other work it does; this app turns
  // that into rows. Subscribed for the life of the load and dropped after.
  const stopProgress = handle.on('timeline:progress', ({ event: p }) => {
    if (p.stage === TimelineStage.Assemble) {
      // The server's wait, but the same wait as the build after it: one readout.
      if (overlay) setLoadingStep(LoadingStep.Building);
      return;
    }
    const tail = timelineStageTail(p);
    if (!overlay) {
      setRebuildDetail(tail);
      return;
    }
    const step = stepForTimelineStage(p.stage);
    setLoadingStep(step);
    setLoadingStepTail(step, tail);
  });

  try {
    // The load is the CITY's: it holds the bundle, the replay and the scrub
    // controller, and the order those go in — mode before the manifest,
    // transparency after the pack, controller last — is a property of the
    // pieces, not of this app. What this app keeps is the readout above it.
    const bundle = await handle.loadTimeline({
      src,
      branch,
      commit,
      keepPosition: inPlace,
      exclude: activeExcludePathsFor(src),
      noCache,
    });
    if (cancelled) return; // user backed out during the fetch — live view stands
    committed = true; // past here the scene is repacked; no longer cancellable
    setTimelineBundle(bundle);
    commitSource(src, branch, bundle.unionManifest as unknown as Manifest);
    if (overlay) {
      // Hold the overlay through the union city's first painted frame.
      requestAnimationFrame(() => {
        hideLoadingOverlay();
      });
    }
  } catch (err) {
    if (cancelled) return; // user cancel already aborted the fetch + restored live
    // The city unwinds its own scene — the mode, the controller, the
    // transparency — so what is left here is telling the reader.
    if (overlay) hideLoadingOverlay();
    failHostWork(err);
  } finally {
    // For the life of THIS load: the city outlives it, and a subscription left
    // behind would draw the next load's rows over a readout that has moved on.
    stopProgress();
  }
}

/** Enter Timeline for the source already open. */
export function loadTimelineScene(
  opts: {
    inPlace?: boolean;
    noCache?: boolean;
    overlay?: boolean;
    commit?: string;
  } = {}
): Promise<void> {
  const cur = CURRENT_SOURCE.peek();
  if (!cur) return Promise.resolve();
  return loadTimelineSource({ src: cur.src, branch: cur.branch, ...opts });
}

// A refresh in Timeline → refetch the bundle, not a HEAD re-scan. A callback
// because a direct import was a cycle; registered before the mode can turn on.
setTimelineRefreshHandler((opts) => loadTimelineScene({ inPlace: true, ...opts }));

// Re-pack from the warm bundle, holding SCRUB_POS, so a settings Save in
// Timeline stays in Timeline instead of dropping to live HEAD.
// Scene-free: the city-layer effect (city/index.ts) reacts to TIMELINE_MODE and does the scene teardown.
export function teardownTimelineMode(): void {
  resetTimelineMode();
}
