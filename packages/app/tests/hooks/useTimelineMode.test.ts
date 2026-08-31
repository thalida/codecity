import {
  type TimelineBundle,
  type TimelineProgress,
  TimelineStage,
  type PickTarget,
  createTimelineState,
} from '@codecity/city';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { signal } from '@preact/signals';

import { loadTimelineScene, teardownTimelineMode } from '@/features/city/state/timeline';
import { CURRENT_SOURCE } from '@/state/source';
import { HOST_WORK, REBUILD_DETAIL } from '@/features/city/state/readout';
import { LOADING_OVERLAY, LOADING_CANCEL } from '@/features/city/state/overlay';
import { LoadingStep, TIMELINE_LOADING_STEPS, BuildStage } from '@/features/city/state/loading';
import { createEmitter } from '@codecity/city/testing';
import { stubSceneCity, type StubSceneCity } from '../_helpers/sceneCity';
import { flush } from '../_helpers/preact';

// jsdom's rAF fires for real on a ~16ms timer; wait for one tick to observe
// the post-paint hide (mirrors filePreviewPane.test.tsx's rAF handling).
const nextFrame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));

// repo, like the server's union manifest carries: Timeline commits this as the
// manifest the header and panes read, so a bare tree is not a fixture of one.
const UNION_REPO = { branch: 'main', remote_url: null, head_sha: 'c', dirty: false };

const BUNDLE = {
  commits: [{ sha: 'a' }, { sha: 'b' }, { sha: 'c' }],
  unionManifest: { tree: { name: 'r' }, stats: {}, repo: UNION_REPO },
  deltas: [],
  blobLines: {},
  blobSizes: {},
  note: null,
} as unknown as TimelineBundle;

function fakeHandle() {
  const applyManifest = vi.fn().mockResolvedValue(undefined);
  // The hook opens the build's readout on the stages the apply will run, so a
  // handle without this can't be driven through a load.
  const buildStagesFor = vi.fn().mockReturnValue([BuildStage.Layout, BuildStage.Assemble]);
  const installScrubController = vi.fn();
  const uninstallScrubController = vi.fn();
  const setStreetsTransparent = vi.fn();
  const setFootprintsTransparent = vi.fn();
  // The load is the city's now: this records what it was ASKED for, which is the whole of what
  // this app is still responsible for.
  const events = createEmitter();
  // A real city INSTALLS what it loaded, as part of the load: the app never calls setBundle
  // itself.
  const loadTimeline = vi.fn(async () => {
    handle.timeline.setBundle(BUNDLE);
    return BUNDLE;
  });
  const cancelTimelineLoad = vi.fn();
  const watchSource = vi.fn(() => () => {});
  const refreshSource = vi.fn(async () => {});
  const handle = {
    applyManifest,
    buildStagesFor,
    watchSource,
    refreshSource,
    loadTimeline,
    cancelTimelineLoad,
    on: events.on,
    // SELECTION_KEY reads through the handle's picker, so a handle without one
    // isn't a SceneHandle any consumer can hold.
    picker: { selection: signal<PickTarget | null>(null) },
    // A real engine with the scrub-install surface bolted on.
    timeline: Object.assign(createTimelineState(), {
      installScrubController,
      uninstallScrubController,
      setStreetsTransparent,
      setFootprintsTransparent,
    }),
  };
  return {
    handle,
    events,
    loadTimeline,
    cancelTimelineLoad,
    applyManifest,
    buildStagesFor,
    watchSource,
    refreshSource,
    installScrubController,
    uninstallScrubController,
    setStreetsTransparent,
    setFootprintsTransparent,
  };
}

// Leaving Timeline reloads live HEAD, and a live load goes through the city
// now, so this file needs one published.
let city: StubSceneCity;
beforeEach(() => {
  city = stubSceneCity();
});
afterEach(() => {
  city.dispose();
});

describe('loadTimelineScene', () => {
  let f: ReturnType<typeof fakeHandle>;

  beforeEach(() => {
    // Published first: the app's timeline store is a view of THIS city's
    // engine, so state set before it exists lands on a detached one.
    f = fakeHandle();
    CURRENT_SOURCE.value = { src: 's', branch: undefined };
    // Reset: SOURCE_INFO reads it, so a manifest left by a neighbour decides
    // whether this test throws.
    f.handle.timeline.exit();
    f.handle.timeline.setPosition(0);
    f.handle.timeline.setBundle(null);
    LOADING_OVERLAY.value = { visible: false, showOpts: null, activeStep: null, stepTails: {} };
    HOST_WORK.value = { busy: false, error: null };
    // Reset, not clear: clear drops the CALLS and keeps the implementation, so
    // a rejection staged by one case is still staged for the next.
    f.loadTimeline.mockReset();
    f.loadTimeline.mockImplementation(async () => {
      f.handle.timeline.setBundle(BUNDLE);
      return BUNDLE;
    });
  });
  afterEach(() => {
    f.handle.timeline.exit();
  });

  // The load itself — the order of mode, pack, transparency and controller — is the CITY's,
  // and is covered in packages/city/tests/loadTimeline.test.ts.
  it('asks the city for the open source’s history, and shows what came back', async () => {
    await loadTimelineScene(f.handle as never);

    expect(f.loadTimeline).toHaveBeenCalledWith(
      expect.objectContaining({ src: 's', branch: undefined, exclude: expect.any(Array) })
    );
    // The bundle every pane reads, and the source it belongs to.
    expect(f.handle.timeline.bundle).toBe(BUNDLE);

    // Overlay held through the first painted frame, then hidden.
    await nextFrame();
    expect(LOADING_OVERLAY.value.visible).toBe(false);
  });

  it('shows the full loading overlay (not just the footer) and drives it through the stages then Building', async () => {
    let resolveFetch!: (b: TimelineBundle) => void;
    f.loadTimeline.mockImplementation(
      () =>
        new Promise<TimelineBundle>((resolve) => {
          resolveFetch = resolve;
        })
    );
    const entering = loadTimelineScene(f.handle as never);
    await flush();
    expect(LOADING_OVERLAY.value.visible).toBe(true);
    expect(LOADING_OVERLAY.value.showOpts?.steps).toEqual(TIMELINE_LOADING_STEPS);
    // 's' is a path, not a URL: there is nothing to fetch, so the list opens on
    // the walk (the fetch row is covered by loadingOverlay.test.tsx).
    f.events.emit('timeline:progress', {
      event: { stage: TimelineStage.History, commits: 12000 } as never,
    });
    expect(LOADING_OVERLAY.value.activeStep).toBe(LoadingStep.TimelineHistory);

    // Union assembly is the last thing the server reports, and the pack that
    // follows is the same wait: one row from here to the painted city.
    f.events.emit('timeline:progress', {
      event: { stage: TimelineStage.Assemble, percent: 62 } as never,
    });
    expect(LOADING_OVERLAY.value.activeStep).toBe(LoadingStep.Building);

    resolveFetch(BUNDLE);
    await entering;
    // The overlay is held through the union city's first painted frame.
    expect(LOADING_OVERLAY.value.visible).toBe(true);

    await nextFrame();
    expect(LOADING_OVERLAY.value.visible).toBe(false);
  });

  it('walks the overlay one row per server stage, each carrying its own tail', async () => {
    // The city reports the assembly on its own events; this app turns that
    // into rows, which is the whole of what it still owns here.
    const onProgress = (event: TimelineProgress) => f.events.emit('timeline:progress', { event });
    let resolveFetch!: (b: TimelineBundle) => void;
    f.loadTimeline.mockImplementation(
      () =>
        new Promise<TimelineBundle>((resolve) => {
          resolveFetch = resolve;
        })
    );

    const entering = loadTimelineScene(f.handle as never);
    await flush();

    onProgress({ stage: TimelineStage.Fetch, percent: 40 });
    expect(LOADING_OVERLAY.value.activeStep).toBe(LoadingStep.TimelineFetch);
    expect(LOADING_OVERLAY.value.stepTails[LoadingStep.TimelineFetch]).toBe('40%');

    onProgress({ stage: TimelineStage.History, commits: 12000 });
    expect(LOADING_OVERLAY.value.activeStep).toBe(LoadingStep.TimelineHistory);
    expect(LOADING_OVERLAY.value.stepTails[LoadingStep.TimelineHistory]).toBe('12,000 commits');

    onProgress({ stage: TimelineStage.Blobs, blobsDone: 5, blobsTotal: 10 });
    expect(LOADING_OVERLAY.value.activeStep).toBe(LoadingStep.TimelineBlobs);
    expect(LOADING_OVERLAY.value.stepTails[LoadingStep.TimelineBlobs]).toBe('5/10 files');
    // Each stage keeps its own tail, so a finished row still says what it found.
    expect(LOADING_OVERLAY.value.stepTails[LoadingStep.TimelineHistory]).toBe('12,000 commits');

    // Union assembly opens the build's own readout rather than a tail beside it,
    // so the row counts one percent from here through to the painted city.
    onProgress({ stage: TimelineStage.Assemble, percent: 62 });
    // The row it lands on is the readout; the percent inside it is the CITY's
    // (city.status.fraction), so there is no second plan here to assert on.
    expect(LOADING_OVERLAY.value.activeStep).toBe(LoadingStep.Building);

    resolveFetch(BUNDLE);
    await entering;
    expect(LOADING_OVERLAY.value.activeStep).toBe(LoadingStep.Building);
    // Let the reveal frame run here: a leaked rAF hides the overlay out of a
    // later test instead.
    await nextFrame();
  });

  it('no-ops without a current source', async () => {
    CURRENT_SOURCE.value = null;
    await loadTimelineScene(f.handle as never);
    expect(f.loadTimeline).not.toHaveBeenCalled();
    expect(f.handle.timeline.mode).toBe(false);
    expect(LOADING_OVERLAY.value.visible).toBe(false);
  });

  it('surfaces a fetch error, leaves mode unset, and hides the overlay', async () => {
    f.loadTimeline.mockRejectedValue(new Error('boom'));
    await loadTimelineScene(f.handle as never);
    // Unwinding the SCENE is the city's — it never entered the mode, since the
    // load threw before it got there. What this app owes is the readout.
    expect(f.handle.timeline.mode).toBe(false);
    expect(LOADING_OVERLAY.value.visible).toBe(false);
    expect(HOST_WORK.value.error).not.toBeNull();
  });

  // The bundle caches per HEAD, so a Fresh scan that did not say so would be
  // answered from the very cache it asked to ignore.
  it('asks the history read to ignore its cache for a fresh scan', async () => {
    f.loadTimeline.mockResolvedValue(BUNDLE);

    await loadTimelineScene(f.handle as never, { inPlace: true, noCache: true });

    expect(f.loadTimeline).toHaveBeenCalledWith(expect.objectContaining({ noCache: true }));
  });

  it('leaves the cache alone on an ordinary refetch', async () => {
    f.loadTimeline.mockResolvedValue(BUNDLE);

    await loadTimelineScene(f.handle as never, { inPlace: true });

    expect(f.loadTimeline).toHaveBeenCalledWith(expect.objectContaining({ noCache: false }));
  });
});

describe('teardownTimelineMode', () => {
  let f: ReturnType<typeof fakeHandle>;
  beforeEach(() => {
    f = fakeHandle();
  });

  it('leaves the mode and the history behind it, touching nothing else', () => {
    f.handle.timeline.enter();
    f.handle.timeline.setPosition(2);
    f.handle.timeline.setBundle(BUNDLE);

    teardownTimelineMode(f.handle as never);

    expect(f.handle.timeline.mode).toBe(false);
    expect(f.handle.timeline.pos).toBe(0);
    expect(f.handle.timeline.bundle).toBeNull();
  });
});

describe('loadTimelineScene inPlace refetch', () => {
  let f: ReturnType<typeof fakeHandle>;

  beforeEach(() => {
    // Published first: the app's timeline store is a view of THIS city's
    // engine, so state set before it exists lands on a detached one.
    f = fakeHandle();
    CURRENT_SOURCE.value = { src: 's', branch: undefined };
    f.handle.timeline.enter();
    f.handle.timeline.setPosition(2);
    f.handle.timeline.setBundle(BUNDLE);
    HOST_WORK.value = { busy: false, error: null }; // inPlace reports through the footer
    REBUILD_DETAIL.value = null;
    LOADING_OVERLAY.value = { visible: false, showOpts: null, activeStep: null, stepTails: {} };
    // Reset, not clear: clear drops the CALLS and keeps the implementation, so
    // a rejection staged by one case is still staged for the next.
    f.loadTimeline.mockReset();
    f.loadTimeline.mockImplementation(async () => {
      f.handle.timeline.setBundle(BUNDLE);
      return BUNDLE;
    });
  });
  afterEach(() => {
    f.handle.timeline.exit();
  });

  it('refetches the bundle with the current excludes, re-packs, and holds SCRUB_POS', async () => {
    const NEXT = {
      ...BUNDLE,
      unionManifest: { tree: { name: 'r2' }, stats: {}, repo: UNION_REPO },
    } as unknown as TimelineBundle;
    f.loadTimeline.mockImplementation(async () => {
      f.handle.timeline.setBundle(NEXT);
      return NEXT;
    });

    await loadTimelineScene(f.handle as never, { inPlace: true });

    // The re-pack and the controller are inside the city's load; what this app
    // asked for, and what it did with the answer, is its half.
    expect(f.loadTimeline).toHaveBeenCalledWith(
      expect.objectContaining({ exclude: expect.any(Array), keepPosition: true })
    );
    expect(f.handle.timeline.bundle).toBe(NEXT);
  });

  // A refetch is about the source already open; without one there is nothing to re-read, and
  // waiting for a city that will never come would hang the readout it opened.
  it('no-ops with no source open', async () => {
    CURRENT_SOURCE.value = null;
    await loadTimelineScene(f.handle as never, { inPlace: true });
    expect(f.loadTimeline).not.toHaveBeenCalled();
  });

  // An exclude edit refetches under a city that is already on screen: no
  // overlay, so the freshness readout is the only place the stages can show.
  it('reports its stages through the freshness readout when no overlay is asked for', async () => {
    // The city reports the assembly on its own events; this app turns that
    // into rows, which is the whole of what it still owns here.
    const onProgress = (event: TimelineProgress) => f.events.emit('timeline:progress', { event });
    let resolveFetch!: (b: TimelineBundle) => void;
    f.loadTimeline.mockImplementation(
      () =>
        new Promise<TimelineBundle>((resolve) => {
          resolveFetch = resolve;
        })
    );

    const refetching = loadTimelineScene(f.handle as never, { inPlace: true });
    await flush();
    expect(LOADING_OVERLAY.value.visible).toBe(false);
    expect(HOST_WORK.value.busy).toBe(true);

    onProgress({ stage: TimelineStage.History, commits: 12000 });
    expect(REBUILD_DETAIL.value).toBe('12,000 commits');
    onProgress({ stage: TimelineStage.Blobs, blobsDone: 5, blobsTotal: 10 });
    expect(REBUILD_DETAIL.value).toBe('5/10 files');

    resolveFetch(BUNDLE);
    await refetching;
    expect(LOADING_OVERLAY.value.visible).toBe(false);
  });

  // A Fresh scan in Timeline is a deliberate cacheless walk: minutes of work
  // that used to sit behind the freshness dot alone.
  it('shows the stepped overlay for a refetch the user asked for, holding the scrub', async () => {
    // The city reports the assembly on its own events; this app turns that
    // into rows, which is the whole of what it still owns here.
    const onProgress = (event: TimelineProgress) => f.events.emit('timeline:progress', { event });
    let resolveFetch!: (b: TimelineBundle) => void;
    f.loadTimeline.mockImplementation(
      () =>
        new Promise<TimelineBundle>((resolve) => {
          resolveFetch = resolve;
        })
    );

    const refetching = loadTimelineScene(f.handle as never, {
      inPlace: true,
      noCache: true,
      overlay: true,
    });
    await flush();
    expect(LOADING_OVERLAY.value.visible).toBe(true);
    expect(LOADING_OVERLAY.value.showOpts?.steps).toEqual(TIMELINE_LOADING_STEPS);

    onProgress({ stage: TimelineStage.History, commits: 12000 });
    expect(LOADING_OVERLAY.value.activeStep).toBe(LoadingStep.TimelineHistory);
    expect(LOADING_OVERLAY.value.stepTails[LoadingStep.TimelineHistory]).toBe('12,000 commits');
    expect(REBUILD_DETAIL.value).toBeNull(); // the overlay is saying it; the readout is behind it

    resolveFetch(BUNDLE);
    await refetching;
    expect(f.handle.timeline.pos).toBe(2); // held, not reset to the present
    await nextFrame();
    expect(LOADING_OVERLAY.value.visible).toBe(false);
  });

  it('a cancel on that overlay leaves the timeline it is already showing alone', async () => {
    // The city owns the request and its abort: cancelling asks IT to stop, and
    // the load it was running rejects.
    let rejectLoad!: (e: Error) => void;
    f.loadTimeline.mockImplementation(
      () => new Promise<TimelineBundle>((_resolve, reject) => void (rejectLoad = reject))
    );
    f.cancelTimelineLoad.mockImplementation(() => {
      const aborted = new Error('Timeline load aborted');
      aborted.name = 'AbortError';
      rejectLoad(aborted);
    });

    const refetching = loadTimelineScene(f.handle as never, {
      inPlace: true,
      noCache: true,
      overlay: true,
    });
    await flush();
    LOADING_CANCEL.value?.();
    await refetching;

    expect(LOADING_OVERLAY.value.visible).toBe(false);
    expect(f.handle.timeline.mode).toBe(true); // still in Timeline
    expect(f.handle.timeline.bundle).toBe(BUNDLE); // on the bundle it already had
    expect(f.applyManifest).not.toHaveBeenCalled();
    expect(HOST_WORK.value).toEqual({ busy: false, error: null }); // nothing to unwind
  });
});
