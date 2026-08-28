// hooks/useTimelineMode.ts — enter/exit the explicit Timeline mode. Enter packs
// the union city once and installs the scrub controller; exit reloads live HEAD.
// Every exit path only flips TIMELINE_MODE: the city layer (city/index.ts)
// reacts to that and does the scene teardown itself.

import {
  buildPathTimelines,
  nextPaint,
  Manifest,
  TimelineBundle,
  TimelineProgress,
  TimelineStage,
} from '@codecity/city';
import {
  CURRENT_SOURCE,
  SOURCE_INFO,
  RECENTS,
  commitSource,
  activeExcludePathsFor,
} from '@/state/stores/source';
import { SCENE_HANDLE, whenSceneHandle } from '@/state/stores/city';
import {
  beginBuild,
  enterBuildStage,
  setBuildStagePercent,
  markError,
  markRebuilding,
  setRebuildDetail,
  showLoadingOverlay,
  setLoadingStep,
  setLoadingStepTail,
  hideLoadingOverlay,
  setLoadingCancel,
  PENDING_SOURCE_LABEL,
} from '@/state/stores/progress';
import {
  BuildStage,
  PACK_STAGES,
  LoadingStep,
  TIMELINE_LOADING_STEPS,
  stepForTimelineStage,
  transferTail,
} from '@/constants/progress';
import { srcKind } from '@/utils/sources';
import {
  TIMELINE_MODE,
  TIMELINE_BUNDLE,
  setTimelineBundle,
  SCRUB_POS,
  SCRUB_MAX,
  resetTimelineMode,
  beginTimelineMode,
  setScrubPos,
} from '@/state/stores/timeline';
import {
  loadSource,
  cancelLoad,
  setTimelineRefreshHandler,
  setTimelineBootHandler,
} from '@/hooks/useManifestSource';
import { API } from '@/apiClient';

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
  const abort = new AbortController();
  let cancelled = false;
  let committed = false;

  // Unoverlaid, the readout is the only progress surface: say so now, and the
  // stage tails land beside it. Overlaid, a cancel has nothing to unwind.
  if (inPlace && !overlay) markRebuilding();
  if (overlay) {
    // Cancelling keeps whatever is on screen: nothing is touched until the pack
    // below sets `committed`.
    PENDING_SOURCE_LABEL.value =
      SOURCE_INFO.peek().label || RECENTS.peek().find((r) => r.src === src)?.label || null;
    showLoadingOverlay({ kind: srcKind(src), branch, steps: TIMELINE_LOADING_STEPS }, () => {
      if (committed) return;
      cancelled = true;
      abort.abort();
      hideLoadingOverlay();
    });
  }

  // A cold boot can outrun the city it packs into; a refetch can't, so no handle
  // there means nothing to refetch and waiting would hang the overlay.
  if (inPlace && !SCENE_HANDLE.peek()) return;
  const handle = await whenSceneHandle();
  if (cancelled) return;

  // The plan the whole Building row counts over, opened when the server starts
  // assembling and reopened identically below so the bundle can't reset it.
  const buildPlan = (clientStages: readonly BuildStage[]): BuildStage[] => [
    BuildStage.Assembling,
    BuildStage.Replay,
    ...clientStages,
  ];

  // One row per server stage, so a stall is attributable to the stage it is in
  // and the rows below say what is still to come.
  let assemblyOpen = false;
  const onProgress = (p: TimelineProgress): void => {
    if (p.stage === TimelineStage.Assemble) {
      // The server's wait, but the same wait as the build after it: one readout.

      if (!assemblyOpen) {
        assemblyOpen = true;
        beginBuild(buildPlan(PACK_STAGES));
      }
      if (p.percent != null) setBuildStagePercent(p.percent);
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
  };

  try {
    const bundle = await API.fetchTimelineBundle(src, branch, onProgress, {
      signal: abort.signal,
      exclude: activeExcludePathsFor(src),
      noCache,
    });
    if (cancelled) return; // user backed out during the fetch — live view stands
    committed = true; // past here the scene is repacked; no longer cancellable
    setTimelineBundle(bundle);
    if (overlay) setLoadingStep(LoadingStep.Building);
    markRebuilding();
    // The bundle's union manifest is a Manifest like any other — repo info,
    // commits, signals — so the panes, header and tree read Timeline's own.
    const manifest = bundle.unionManifest as unknown as Manifest;
    // The replay and the fan-out below run before the apply that would name
    // them: open the same plan the assembly did, and paint before the freeze.
    beginBuild(buildPlan(handle.buildStagesFor(manifest)));
    enterBuildStage(BuildStage.Replay);
    await nextPaint();
    const timelines = buildPathTimelines(bundle);
    // Before the manifest: the mode is what tells the scene layer whose city to
    // pack, and the commit below would otherwise land as a live one.
    beginTimelineMode();
    commitSource(src, branch, manifest);
    await handle.applyManifest(manifest, [BuildStage.Assembling, BuildStage.Replay]);
    // Flip after the pack: applyManifest rebuilds the street + footprint meshes opaque.
    handle.timeline.setStreetsTransparent(true);
    handle.timeline.setFootprintsTransparent(true);
    handle.timeline.installScrubController(timelines, bundle.commitLineRanges);
    // A refetch holds position (self-clamping if the bundle shrank), a named
    // commit rests on it, and anything else opens at the present.
    setScrubPos(scrubTarget(bundle, commit, inPlace));
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

/** Where the scrubber lands. An unknown sha falls through to the present rather
 *  than erroring: the union cap can drop one, and a link can go stale. */
function scrubTarget(bundle: TimelineBundle, commit: string | undefined, inPlace: boolean): number {
  if (commit) {
    const idx = bundle.commits.findIndex((c) => c.sha === commit);
    if (idx >= 0) return idx;
  }
  return inPlace ? SCRUB_POS.peek() : SCRUB_MAX.peek();
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

// The boot path, for the same reason. `?mode=timeline` loads the bundle and
// nothing else: Live's scan is a different view's load, and it can wait for one.
setTimelineBootHandler((payload) => loadTimelineSource(payload));

// Enter Timeline if it isn't on, then scrub to the commit. No-op if the sha
// isn't in the bundle (the union cap can drop one) or the mode failed to engage.
export async function viewCommitInTimeline(sha: string): Promise<void> {
  if (!TIMELINE_MODE.peek()) {
    await loadTimelineScene({ commit: sha });
    return; // the load rests on the commit itself; a failure is surfaced already
  }
  const bundle = TIMELINE_BUNDLE.peek();
  if (!bundle) return;
  const idx = bundle.commits.findIndex((c) => c.sha === sha);
  if (idx >= 0) setScrubPos(idx);
}

// Re-pack from the warm bundle, holding SCRUB_POS, so a settings Save in
// Timeline stays in Timeline instead of dropping to live HEAD.
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
