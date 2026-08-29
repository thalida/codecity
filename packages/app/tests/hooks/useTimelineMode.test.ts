import {
  TimelineBundle,
  TimelineProgress,
  TimelineStage,
  PickTarget,
  createTimelineState,
} from '@codecity/city';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { signal } from '@preact/signals';

import { loadTimelineScene, exitTimelineMode, teardownTimelineMode } from '@/hooks/useTimelineMode';
import { EXCLUDES, addExclude, CURRENT_SOURCE } from '@/state/stores/source';
import {
  SCRUB_POS,
  TIMELINE_BUNDLE,
  TIMELINE_MODE,
  beginTimelineMode,
  resetTimelineMode,
  setScrubPos,
  setTimelineBundle,
} from '@/state/stores/timeline';
import { SCENE_HANDLE } from '@/state/stores/city';
import { MANIFEST } from '@/state/stores/manifest';
import {
  HOST_WORK,
  REBUILD_DETAIL,
  LOADING_OVERLAY,
  LOADING_CANCEL,
  LOADING_SOURCE,
} from '@/state/stores/progress';
import { LoadingStep, TIMELINE_LOADING_STEPS, BuildStage } from '@/constants/progress';
import { LIVE_UPDATES } from '@/state/settings/values/updates';
import { createEmitter, EMPTY_MANIFEST } from '@codecity/city/testing';
import { setupLiveUpdates } from '@/hooks/useManifestSource';
import { StubEventSource, installEventSource } from '@codecity/city/testing';
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
  // The load is the city's now: this records what it was ASKED for, which is
  // the whole of what this app is still responsible for. The emitter is real,
  // so a test can drive the progress the city would report during one.
  const events = createEmitter();
  const loadTimeline = vi.fn(async () => BUNDLE);
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
    // A real engine with the scrub-install surface bolted on. NOT a spread of
    // one: its values are getters, and spreading copies what they read at that
    // moment, which freezes the whole thing.
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
    SCENE_HANDLE.value = f.handle as never;
    CURRENT_SOURCE.value = { src: 's', branch: undefined };
    // Reset: SOURCE_INFO reads it, so a manifest left by a neighbour decides
    // whether this test throws.
    MANIFEST.value = null;
    resetTimelineMode();
    setScrubPos(0);
    setTimelineBundle(null);
    LOADING_OVERLAY.value = { visible: false, showOpts: null, activeStep: null, stepTails: {} };
    HOST_WORK.value = { busy: false, error: null };
    // Reset, not clear: clear drops the CALLS and keeps the implementation, so
    // a rejection staged by one case is still staged for the next.
    f.loadTimeline.mockReset();
    f.loadTimeline.mockResolvedValue(BUNDLE);
  });
  afterEach(() => {
    resetTimelineMode();
    SCENE_HANDLE.value = null;
  });

  // The load itself — the order of mode, pack, transparency and controller — is
  // the CITY's, and is covered in packages/city/tests/loadTimeline.test.ts.
  // What this app is responsible for is asking for the right thing, and what it
  // does with the answer.
  it('asks the city for the open source’s history, and shows what came back', async () => {
    await loadTimelineScene();

    expect(f.loadTimeline).toHaveBeenCalledWith(
      expect.objectContaining({ src: 's', branch: undefined, exclude: expect.any(Array) })
    );
    // The bundle every pane reads, and the source it belongs to.
    expect(TIMELINE_BUNDLE.value).toBe(BUNDLE);

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
    const entering = loadTimelineScene();
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

    const entering = loadTimelineScene();
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
    await loadTimelineScene();
    expect(f.loadTimeline).not.toHaveBeenCalled();
    expect(TIMELINE_MODE.value).toBe(false);
    expect(LOADING_OVERLAY.value.visible).toBe(false);
  });

  it('surfaces a fetch error, leaves mode unset, and hides the overlay', async () => {
    f.loadTimeline.mockRejectedValue(new Error('boom'));
    await loadTimelineScene();
    // Unwinding the SCENE is the city's — it never entered the mode, since the
    // load threw before it got there. What this app owes is the readout.
    expect(TIMELINE_MODE.value).toBe(false);
    expect(LOADING_OVERLAY.value.visible).toBe(false);
    expect(HOST_WORK.value.error).not.toBeNull();
  });

  // The bundle caches per HEAD, so a Fresh scan that did not say so would be
  // answered from the very cache it asked to ignore.
  it('asks the history read to ignore its cache for a fresh scan', async () => {
    f.loadTimeline.mockResolvedValue(BUNDLE);

    await loadTimelineScene({ inPlace: true, noCache: true });

    expect(f.loadTimeline).toHaveBeenCalledWith(expect.objectContaining({ noCache: true }));
  });

  it('leaves the cache alone on an ordinary refetch', async () => {
    f.loadTimeline.mockResolvedValue(BUNDLE);

    await loadTimelineScene({ inPlace: true });

    expect(f.loadTimeline).toHaveBeenCalledWith(expect.objectContaining({ noCache: false }));
  });
});

describe('exitTimelineMode', () => {
  let restoreEventSource: () => void;
  beforeEach(() => {
    restoreEventSource = installEventSource();
    CURRENT_SOURCE.value = { src: 's', branch: undefined };
    beginTimelineMode();
    setScrubPos(2);
    setTimelineBundle(BUNDLE);
  });
  afterEach(() => {
    restoreEventSource();
    resetTimelineMode();
    SCENE_HANDLE.value = null;
  });

  // The scene-side teardown belongs to the city layer's own effect; this covers
  // the hook's half of the contract.
  it('flips TIMELINE_MODE, clears the scrub store, and reloads live HEAD', async () => {
    exitTimelineMode();

    expect(TIMELINE_MODE.value).toBe(false);
    expect(SCRUB_POS.value).toBe(0);
    expect(TIMELINE_BUNDLE.value).toBeNull();
    await flush();
    expect(StubEventSource.instances.length).toBeGreaterThan(0); // live HEAD reload started
    expect(new URL(StubEventSource.instances[0].url).searchParams.get('ref')).toBeNull();
  });
});

describe('teardownTimelineMode', () => {
  afterEach(() => {
    resetTimelineMode();
  });

  it('is a pure signal flip — no source reload, scene-free', () => {
    beginTimelineMode();
    setScrubPos(2);
    setTimelineBundle(BUNDLE);

    teardownTimelineMode();

    expect(TIMELINE_MODE.value).toBe(false);
    expect(SCRUB_POS.value).toBe(0);
    expect(TIMELINE_BUNDLE.value).toBeNull();
  });
});

describe('this app starts and stops a watch', () => {
  let restoreEventSource: () => void;
  beforeEach(() => {
    restoreEventSource = installEventSource();
    CURRENT_SOURCE.value = { src: 's', branch: undefined };
    MANIFEST.value = { ...EMPTY_MANIFEST, content_signature: 'sig0' };
    LOADING_SOURCE.value = null;
    resetTimelineMode();
  });
  afterEach(() => {
    LIVE_UPDATES.value = { ...LIVE_UPDATES.value, ENABLED: false };
    resetTimelineMode();
    restoreEventSource();
    vi.useRealTimers();
  });

  // The rule that a watch suspends while Timeline owns the scene is the CITY's
  // now — see packages/city/tests/watch.test.ts. What is left here is that this
  // app starts and stops one at all.
  it('starts a watch when live updates are on, and stops it when they go off', async () => {
    LIVE_UPDATES.value = { ...LIVE_UPDATES.value, ENABLED: true, POLL_SECONDS: 1 };
    const dispose = setupLiveUpdates();

    expect(city.watching).toBe(true);

    LIVE_UPDATES.value = { ...LIVE_UPDATES.value, ENABLED: false };
    expect(city.watching).toBe(false);

    dispose();
  });
});

describe('loadTimelineScene inPlace refetch', () => {
  let f: ReturnType<typeof fakeHandle>;

  beforeEach(() => {
    // Published first: the app's timeline store is a view of THIS city's
    // engine, so state set before it exists lands on a detached one.
    f = fakeHandle();
    SCENE_HANDLE.value = f.handle as never;
    CURRENT_SOURCE.value = { src: 's', branch: undefined };
    // SOURCE_INFO reads the loaded manifest for the overlay's repo label.
    MANIFEST.value = { ...EMPTY_MANIFEST, content_signature: 'sig0' };
    beginTimelineMode();
    setScrubPos(2);
    setTimelineBundle(BUNDLE);
    HOST_WORK.value = { busy: false, error: null }; // inPlace reports through the footer
    REBUILD_DETAIL.value = null;
    LOADING_OVERLAY.value = { visible: false, showOpts: null, activeStep: null, stepTails: {} };
    // Reset, not clear: clear drops the CALLS and keeps the implementation, so
    // a rejection staged by one case is still staged for the next.
    f.loadTimeline.mockReset();
    f.loadTimeline.mockResolvedValue(BUNDLE);
  });
  afterEach(() => {
    resetTimelineMode();
    SCENE_HANDLE.value = null;
  });

  it('refetches the bundle with the current excludes, re-packs, and holds SCRUB_POS', async () => {
    const NEXT = {
      ...BUNDLE,
      unionManifest: { tree: { name: 'r2' }, stats: {}, repo: UNION_REPO },
    } as unknown as TimelineBundle;
    f.loadTimeline.mockResolvedValue(NEXT);

    await loadTimelineScene({ inPlace: true });

    // The re-pack and the controller are inside the city's load; what this app
    // asked for, and what it did with the answer, is its half.
    expect(f.loadTimeline).toHaveBeenCalledWith(
      expect.objectContaining({ exclude: expect.any(Array), keepPosition: true })
    );
    expect(TIMELINE_BUNDLE.value).toBe(NEXT);
  });

  it('no-ops without a scene handle', async () => {
    SCENE_HANDLE.value = null;
    await loadTimelineScene({ inPlace: true });
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

    const refetching = loadTimelineScene({ inPlace: true });
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

    const refetching = loadTimelineScene({ inPlace: true, noCache: true, overlay: true });
    await flush();
    expect(LOADING_OVERLAY.value.visible).toBe(true);
    expect(LOADING_OVERLAY.value.showOpts?.steps).toEqual(TIMELINE_LOADING_STEPS);

    onProgress({ stage: TimelineStage.History, commits: 12000 });
    expect(LOADING_OVERLAY.value.activeStep).toBe(LoadingStep.TimelineHistory);
    expect(LOADING_OVERLAY.value.stepTails[LoadingStep.TimelineHistory]).toBe('12,000 commits');
    expect(REBUILD_DETAIL.value).toBeNull(); // the overlay is saying it; the readout is behind it

    resolveFetch(BUNDLE);
    await refetching;
    expect(SCRUB_POS.value).toBe(2); // held, not reset to the present
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

    const refetching = loadTimelineScene({ inPlace: true, noCache: true, overlay: true });
    await flush();
    LOADING_CANCEL.value?.();
    await refetching;

    expect(LOADING_OVERLAY.value.visible).toBe(false);
    expect(TIMELINE_MODE.value).toBe(true); // still in Timeline
    expect(TIMELINE_BUNDLE.value).toBe(BUNDLE); // on the bundle it already had
    expect(f.applyManifest).not.toHaveBeenCalled();
    expect(HOST_WORK.value).toEqual({ busy: false, error: null }); // nothing to unwind
  });
});

describe('exclude edit in Timeline routes to a bundle refetch (regression: #128)', () => {
  let f: ReturnType<typeof fakeHandle>;

  let restoreEventSource: () => void;
  beforeEach(() => {
    restoreEventSource = installEventSource();
    // Published first, for the same reason as the block above.
    f = fakeHandle();
    SCENE_HANDLE.value = f.handle as never;
    CURRENT_SOURCE.value = { src: 's', branch: undefined };
    MANIFEST.value = { ...EMPTY_MANIFEST, content_signature: 'sig0' };
    LOADING_SOURCE.value = null;
    beginTimelineMode();
    setScrubPos(2);
    setTimelineBundle(BUNDLE);
    EXCLUDES.value = {};
    // Reset, not clear: clear drops the CALLS and keeps the implementation, so
    // a rejection staged by one case is still staged for the next.
    f.loadTimeline.mockReset();
    f.loadTimeline.mockResolvedValue(BUNDLE);
    f.loadTimeline.mockResolvedValue(BUNDLE);
  });
  afterEach(() => {
    restoreEventSource();
    resetTimelineMode();
    SCENE_HANDLE.value = null;
    EXCLUDES.value = {};
  });

  it('refetches the union bundle with the new exclude and opens no live stream', async () => {
    const dispose = setupLiveUpdates();

    addExclude('vendor');
    await flush();

    expect(f.loadTimeline).toHaveBeenCalledTimes(1);
    expect(f.loadTimeline).toHaveBeenCalledWith(expect.objectContaining({ exclude: ['vendor'] }));
    expect(StubEventSource.instances.length).toBe(0); // Timeline must not fall back to a live re-scan
    dispose();
  });
});
