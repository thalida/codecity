// state/city/timelineMode.ts — enter/exit the explicit Timeline mode for ONE
// city. Enter packs the union city once and installs the scrub controller;
// exit reloads live HEAD. Every exit path only flips the mode: the city layer
// (city/index.ts) reacts to that and does the scene teardown itself.

import { fetchTimelineBundle } from '@/api/timeline';
import { buildPathTimelines } from '@/city/timeline/replay';
import { RECENTS, activeExcludePathsFor } from '@/state/stores/source';
import { whenScene } from '@/state/city/commands';
import {
  BuildStage,
  PACK_STAGES,
  LoadingStep,
  TIMELINE_LOADING_STEPS,
  stepForTimelineStage,
  transferTail,
} from '@/constants/progress';
import { nextPaint } from '@/city/utils/nextPaint';
import { srcKind } from '@/utils/sources';
import { TimelineStage } from '@/types';
import type { CitySession } from '@/state/city/session';
import type { Manifest, TimelineBundle, TimelineProgress } from '@/types';

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
/** Everything Timeline does to one city. Held by its session, so a second city
 *  scrubs its own history with its own overlay and its own this.session.scene. */
export class TimelineMode {
  constructor(private readonly session: CitySession) {}

  /** Enter Timeline for an explicit source (the `?mode=timeline` boot). */
  loadSource = async ({
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
  }): Promise<void> => {
    const abort = new AbortController();
    let cancelled = false;
    let committed = false;

    // Unoverlaid, the readout is the only progress surface: say so now, and the
    // stage tails land beside it. Overlaid, a cancel has nothing to unwind.
    if (inPlace && !overlay) this.session.progress.markRebuilding();
    if (overlay) {
      // Cancelling keeps whatever is on screen: nothing is touched until the pack
      // below sets `committed`.
      this.session.progress.pendingLabel.value =
        this.session.source.info.peek().label ||
        RECENTS.peek().find((r) => r.src === src)?.label ||
        null;
      this.session.progress.showOverlay(
        { kind: srcKind(src), branch, steps: TIMELINE_LOADING_STEPS },
        () => {
          if (committed) return;
          cancelled = true;
          abort.abort();
          this.session.progress.hideOverlay();
        }
      );
    }

    // A cold boot can outrun the scene it packs into; a refetch can't, so no
    // scene there means nothing to refetch and waiting would hang the overlay.
    if (inPlace && !this.session.scene.peek()) return;
    const handle = await whenScene(this.session.scene);
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
          this.session.progress.beginBuild(buildPlan(PACK_STAGES));
        }
        if (p.percent != null) this.session.progress.setBuildStagePercent(p.percent);
        if (overlay) this.session.progress.setStep(LoadingStep.Building);
        return;
      }
      const tail = timelineStageTail(p);
      if (!overlay) {
        this.session.progress.setDetail(tail);
        return;
      }
      const step = stepForTimelineStage(p.stage);
      this.session.progress.setStep(step);
      this.session.progress.setStepTail(step, tail);
    };

    try {
      const bundle = await fetchTimelineBundle(src, branch, onProgress, {
        signal: abort.signal,
        exclude: activeExcludePathsFor(src),
        noCache,
      });
      if (cancelled) return; // user backed out during the fetch — live view stands
      committed = true; // past here the scene is repacked; no longer cancellable
      this.session.timeline.bundle.value = bundle;
      if (overlay) this.session.progress.setStep(LoadingStep.Building);
      this.session.progress.markRebuilding();
      // The bundle's union manifest is a Manifest like any other — repo info,
      // commits, signals — so the panes, header and tree read Timeline's own.
      const manifest = bundle.unionManifest as unknown as Manifest;
      // The replay and the fan-out below run before the apply that would name
      // them: open the same plan the assembly did, and paint before the freeze.
      this.session.progress.beginBuild(buildPlan(handle.buildStagesFor(manifest)));
      this.session.progress.enterBuildStage(BuildStage.Replay);
      await nextPaint();
      const timelines = buildPathTimelines(bundle);
      // Before the manifest: the mode is what tells the scene layer whose city to
      // pack, and the commit below would otherwise land as a live one.
      this.session.timeline.begin();
      this.session.source.commit(src, branch, manifest);
      await handle.applyManifest(manifest, [BuildStage.Assembling, BuildStage.Replay]);
      // Flip after the pack: applyManifest rebuilds the street + footprint meshes opaque.
      handle.timeline.setStreetsTransparent(true);
      handle.timeline.setFootprintsTransparent(true);
      handle.timeline.installScrubController(timelines, bundle.commitLineRanges);
      // A refetch holds position (self-clamping if the bundle shrank), a named
      // commit rests on it, and anything else opens at the present.
      this.session.timeline.setScrubPos(this.scrubTarget(bundle, commit, inPlace));
      if (overlay) {
        // The pack returns before its meshes are drawn: wait for the frame that
        // carries them, or the reveal lands on a half-built city.
        await handle.whenOnScreen();
        this.session.progress.hideOverlay();
      }
    } catch (err) {
      if (cancelled) return; // user cancel already aborted the fetch + restored live
      // A failure can predate the controller install, so the effect wouldn't
      // fire: tear down here, best-effort so its own throw can't bury `err`.
      if (!inPlace) {
        try {
          this.session.timeline.reset();
          handle.timeline.uninstallScrubController();
          handle.timeline.setStreetsTransparent(false);
          handle.timeline.setFootprintsTransparent(false);
        } catch {
          /* teardown failed; surfacing err + hiding the overlay below is what matters */
        }
      }
      if (overlay) this.session.progress.hideOverlay();
      this.session.progress.markError(err);
    }
  };

  /** Where the scrubber lands. An unknown sha falls through to the present
   *  rather than erroring: the union cap can drop one, and a link can go stale. */
  private scrubTarget(
    bundle: TimelineBundle,
    commit: string | undefined,
    inPlace: boolean
  ): number {
    if (commit) {
      const idx = bundle.commits.findIndex((c) => c.sha === commit);
      if (idx >= 0) return idx;
    }
    return inPlace ? this.session.timeline.scrubPos.peek() : this.session.timeline.scrubMax.peek();
  }

  /** Enter Timeline for the source already open. */
  loadScene = (
    opts: { inPlace?: boolean; noCache?: boolean; overlay?: boolean; commit?: string } = {}
  ): Promise<void> => {
    const cur = this.session.source.current.peek();
    if (!cur) return Promise.resolve();
    return this.loadSource({ src: cur.src, branch: cur.branch, ...opts });
  };

  // Enter Timeline if it isn't on, then scrub to the commit. No-op if the sha
  // isn't in the bundle (the union cap can drop one) or the mode failed to engage.
  /** Enter if it is not on, then scrub to that commit. */
  viewCommit = async (sha: string): Promise<void> => {
    if (!this.session.timeline.mode.peek()) {
      await this.loadScene({ commit: sha });
      return; // the load rests on the commit itself; a failure is surfaced already
    }
    const bundle = this.session.timeline.bundle.peek();
    if (!bundle) return;
    const idx = bundle.commits.findIndex((c) => c.sha === sha);
    if (idx >= 0) this.session.timeline.setScrubPos(idx);
  };

  // Re-pack from the warm bundle, holding SCRUB_POS, so a settings Save in
  // Timeline stays in Timeline instead of dropping to live HEAD.
  /** Rebuild the union city from the warm bundle, holding the position. */
  reassemble = async (): Promise<void> => {
    const handle = this.session.scene.peek();
    const bundle = this.session.timeline.bundle.peek();
    if (!handle || !bundle) return;
    const timelines = buildPathTimelines(bundle);
    await handle.applyManifest(bundle.unionManifest as unknown as Manifest);
    handle.timeline.setStreetsTransparent(true);
    handle.timeline.setFootprintsTransparent(true);
    handle.timeline.installScrubController(timelines, bundle.commitLineRanges);
  };

  // Scene-free: the city-layer effect (city/index.ts) reacts to TIMELINE_MODE and does the scene teardown.
  /** Scene-free: the city layer reacts to the mode and tears its scene down. */
  teardown = (): void => {
    this.session.timeline.reset();
  };

  /** Leave, and reload live HEAD where the scrubber was. */
  exit = (): void => {
    const cur = this.session.source.current.peek();
    const scrubPos = this.session.timeline.scrubPos.peek(); // remember where the scrubber was
    this.teardown();
    if (!cur) return;
    // Cancelling the reload re-enters Timeline where you were rather than dumping
    // you on the switcher. Registered first, so loadSource's overlay keeps it.
    this.session.progress.setCancel(() => {
      this.session.load.cancel();
      void this.loadScene().then(() => {
        if (this.session.timeline.mode.peek()) this.session.timeline.setScrubPos(scrubPos);
      });
    });
    void this.session.load.loadSource({ src: cur.src, branch: cur.branch });
  };
}
