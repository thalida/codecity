// city/loadTimeline.ts — show a repo's history instead of its working tree.
//
// Timeline is a way of showing a city: the union of every file that ever
// existed, packed once, with a scrubber that reveals it commit by commit. The
// package has held the state, the replay and the scrub controller all along —
// only the LOAD was stranded in a host, which meant that host owned the order
// these have to happen in, and any other host would have had to rediscover it.
//
// The order is the whole difficulty. The mode goes on BEFORE the manifest, or
// the apply packs a live city and the commit lands as a live one. The
// transparency flips AFTER the pack, because applying rebuilds the street and
// footprint meshes opaque. And the scrub controller installs last, because it
// drives the meshes that apply just made.

import { buildPathTimelines } from '../timeline/replay';
import type { CodecityClient } from '../client/index';
import type { CityEmitter } from '../state/events';
import type { TimelineState } from '../timeline/state';
import type { TimelineBundle } from '../types/timeline';
import type { Manifest } from '../types/manifest';
import { BuildStage } from '../types/build';

export interface TimelineRequest {
  src: string;
  branch?: string;
  /** Rest the scrubber on this commit. Unknown shas fall through to the
   *  present rather than erroring: a union cap can drop one, and a link goes
   *  stale. */
  commit?: string;
  /** Hold the scrub position rather than opening at the present. What a
   *  refetch under an edited exclude list wants. */
  keepPosition?: boolean;
  exclude?: string[];
  noCache?: boolean;
}

interface TimelineLoaderDeps {
  client: CodecityClient;
  events: CityEmitter;
  timeline: TimelineState;
  applyManifest(manifest: Manifest, leadingStages?: readonly BuildStage[]): Promise<void>;
  setStreetsTransparent(on: boolean): void;
  setFootprintsTransparent(on: boolean): void;
  installScrubController(
    timelines: ReturnType<typeof buildPathTimelines>,
    commitLineRanges: TimelineBundle['commitLineRanges']
  ): void;
  uninstallScrubController(): void;
  /** Let the browser paint before a batch that holds the main thread for
   *  seconds, so a readout naming that work is on screen while it runs. */
  nextPaint(): Promise<void>;
}

export interface TimelineLoader {
  load(request: TimelineRequest): Promise<TimelineBundle>;
  cancel(): void;
  dispose(): void;
}

/** Where the scrubber lands. An unknown sha falls through to the present. */
function scrubTarget(
  bundle: TimelineBundle,
  commit: string | undefined,
  keep: boolean,
  timeline: TimelineState
): number {
  if (commit) {
    const index = bundle.commits.findIndex((c) => c.sha === commit);
    if (index >= 0) return index;
  }
  return keep ? timeline.pos : timeline.max;
}

export function createTimelineLoader(deps: TimelineLoaderDeps): TimelineLoader {
  const { client, events, timeline, applyManifest } = deps;
  let inflight: AbortController | null = null;
  let disposed = false;

  /** Stop the read in flight without saying so: what a NEW read does to the
   *  one it replaces, which no host asked for and none should be told about. */
  function abort(): void {
    inflight?.abort();
    inflight = null;
  }

  function cancel(): void {
    if (!inflight) return;
    abort();
    events.emit('timeline:cancel', {});
  }

  async function load(request: TimelineRequest): Promise<TimelineBundle> {
    if (disposed) throw new Error('city disposed');
    abort();
    const controller = new AbortController();
    inflight = controller;
    const { src, branch, commit, keepPosition = false } = request;

    // The same two events a live load reports through, because it is the same
    // question for a host: is this city coming, and how far along.
    events.emit('timeline:start', { src, branch });
    // Entering is not cancellable past the pack, so a host wanting a cancel
    // affordance offers it while this is in flight.
    let bundle: TimelineBundle;
    try {
      bundle = await client.fetchTimelineBundle(
        src,
        branch,
        (event) => {
          if (!controller.signal.aborted) events.emit('timeline:progress', { event });
        },
        { signal: controller.signal, exclude: request.exclude, noCache: request.noCache }
      );
    } catch (error) {
      if (!controller.signal.aborted) events.emit('timeline:error', { error });
      throw error;
    }
    if (controller.signal.aborted) throw new Error('superseded');

    try {
      timeline.setBundle(bundle);
      // A union manifest is a Manifest like any other — repo info, commits,
      // stats — so a host's panes and tree read Timeline's own without knowing
      // they are in it.
      const manifest = bundle.unionManifest as unknown as Manifest;
      await deps.nextPaint();
      const replay = buildPathTimelines(bundle);
      // BEFORE the manifest: the mode is what tells the pack whose city to
      // build, and the commit below would otherwise land as a live one.
      if (!timeline.mode) timeline.enter();
      await applyManifest(manifest, [BuildStage.Assembling, BuildStage.Replay]);
      // AFTER the pack: applying rebuilds the street and footprint meshes
      // opaque, so flipping before it would be undone by it.
      deps.setStreetsTransparent(true);
      deps.setFootprintsTransparent(true);
      deps.installScrubController(replay, bundle.commitLineRanges);
      timeline.setPosition(scrubTarget(bundle, commit, keepPosition, timeline));
      events.emit('timeline:done', {});
      return bundle;
    } catch (error) {
      // A failure can predate the controller install, so nothing else would
      // unwind it. Best-effort, so its own throw cannot bury the real one.
      try {
        timeline.exit();
        deps.uninstallScrubController();
        deps.setStreetsTransparent(false);
        deps.setFootprintsTransparent(false);
      } catch {
        /* teardown failed; surfacing the original error is what matters */
      }
      events.emit('timeline:error', { error });
      throw error;
    } finally {
      if (inflight === controller) inflight = null;
    }
  }

  return {
    load,
    cancel,
    dispose(): void {
      disposed = true;
      abort();
    },
  };
}
