import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { signal } from '@preact/signals';

import { loadTimelineScene, exitTimelineMode, teardownTimelineMode } from '@/hooks/useTimelineMode';
import { EXCLUDES, addExclude, CURRENT_SOURCE } from '@/state/stores/source';
import { TIMELINE_MODE, SCRUB_POS, TIMELINE_BUNDLE, setScrubPos } from '@/state/stores/timeline';
import { SCENE_HANDLE } from '@/city/sceneHandle';
import { MANIFEST } from '@/state/stores/manifest';
import {
  REBUILD_STATUS,
  RebuildStatus,
  REBUILD_DETAIL,
  BUILD_PROGRESS,
  LOADING_OVERLAY,
  LOADING_CANCEL,
  SCAN_PROGRESS,
} from '@/state/stores/progress';
import { LoadingStep, TIMELINE_LOADING_STEPS, BuildStage } from '@/constants/progress';
import { LIVE_UPDATES } from '@/state/settings/fields/updates';
import { EMPTY_MANIFEST } from '../_helpers/manifestFixtures';
import { setupLiveUpdates, cancelLoad } from '@/hooks/useManifestSource';
import { TimelineStage } from '@/types';
import type { PickTarget, TimelineBundle, TimelineProgress } from '@/types';
import { StubEventSource, installEventSource } from '../_helpers/eventSource';
import { flush } from '../_helpers/preact';

// jsdom's rAF fires for real on a ~16ms timer; wait for one tick to observe
// the post-paint hide (mirrors filePreviewPane.test.tsx's rAF handling).
const nextFrame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));

vi.mock('@/api/timeline', () => ({ fetchTimelineBundle: vi.fn() }));
import { fetchTimelineBundle } from '@/api/timeline';

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
  const handle = {
    applyManifest,
    buildStagesFor,
    // SELECTION_KEY reads through the handle's picker, so a handle without one
    // isn't a SceneHandle any consumer can hold.
    picker: { selection: signal<PickTarget | null>(null) },
    timeline: {
      installScrubController,
      uninstallScrubController,
      setStreetsTransparent,
      setFootprintsTransparent,
    },
  };
  return {
    handle,
    applyManifest,
    buildStagesFor,
    installScrubController,
    uninstallScrubController,
    setStreetsTransparent,
    setFootprintsTransparent,
  };
}

describe('loadTimelineScene', () => {
  beforeEach(() => {
    CURRENT_SOURCE.value = { src: 's', branch: undefined };
    // Reset: SOURCE_INFO reads it, so a manifest left by a neighbour decides
    // whether this test throws.
    MANIFEST.value = null;
    TIMELINE_MODE.value = false;
    setScrubPos(0);
    TIMELINE_BUNDLE.value = null;
    LOADING_OVERLAY.value = { visible: false, showOpts: null, activeStep: null, stepTails: {} };
    REBUILD_STATUS.value = RebuildStatus.Idle;
    (fetchTimelineBundle as unknown as ReturnType<typeof vi.fn>).mockReset();
  });
  afterEach(() => {
    TIMELINE_MODE.value = false;
    SCENE_HANDLE.value = null;
  });

  it('fetches the bundle, applies the union once, installs the controller, and enters mode at the present', async () => {
    (fetchTimelineBundle as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(BUNDLE);
    const f = fakeHandle();
    SCENE_HANDLE.value = f.handle as never;

    await loadTimelineScene();

    expect(fetchTimelineBundle).toHaveBeenCalledWith(
      's',
      undefined,
      expect.any(Function),
      expect.objectContaining({ signal: expect.any(AbortSignal), exclude: expect.any(Array) })
    );
    expect(f.applyManifest).toHaveBeenCalledTimes(1);
    // The replay ran before the apply, and counts in the build's readout.
    expect(f.applyManifest).toHaveBeenCalledWith(BUNDLE.unionManifest, [
      BuildStage.Assembling,
      BuildStage.Replay,
    ]);
    expect(f.setStreetsTransparent).toHaveBeenCalledWith(true);
    expect(f.setFootprintsTransparent).toHaveBeenCalledWith(true);
    expect(f.installScrubController).toHaveBeenCalledTimes(1);
    expect(TIMELINE_BUNDLE.value).toBe(BUNDLE);
    expect(TIMELINE_MODE.value).toBe(true);
    expect(SCRUB_POS.value).toBe(2); // commits.length - 1 → start at present

    // Overlay held through the first painted frame, then hidden.
    await nextFrame();
    expect(LOADING_OVERLAY.value.visible).toBe(false);
  });

  it('shows the full loading overlay (not just the footer) and drives it through the stages then Building', async () => {
    let resolveFetch!: (b: TimelineBundle) => void;
    (fetchTimelineBundle as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      () =>
        new Promise<TimelineBundle>((resolve) => {
          resolveFetch = resolve;
        })
    );
    const f = fakeHandle();
    SCENE_HANDLE.value = f.handle as never;
    // The pack is several frames long now, so sample the overlay at the step
    // right after it instead of racing jsdom's frame clock from out here.
    let visibleAfterPack: boolean | null = null;
    f.installScrubController.mockImplementation(() => {
      visibleAfterPack = LOADING_OVERLAY.value.visible;
    });

    const entering = loadTimelineScene();
    await flush();
    expect(LOADING_OVERLAY.value.visible).toBe(true);
    expect(LOADING_OVERLAY.value.showOpts?.steps).toEqual(TIMELINE_LOADING_STEPS);
    // 's' is a path, not a URL: there is nothing to fetch, so the list opens on
    // the walk (the fetch row is covered by loadingOverlay.test.tsx).
    expect(LOADING_OVERLAY.value.activeStep).toBe(LoadingStep.TimelineHistory);

    resolveFetch(BUNDLE);
    await entering;
    expect(LOADING_OVERLAY.value.activeStep).toBe(LoadingStep.Building);
    expect(visibleAfterPack, 'reveal waits for the first painted frame').toBe(true);

    await nextFrame();
    expect(LOADING_OVERLAY.value.visible).toBe(false);
  });

  it('walks the overlay one row per server stage, each carrying its own tail', async () => {
    let onProgress!: (p: TimelineProgress) => void;
    let resolveFetch!: (b: TimelineBundle) => void;
    (fetchTimelineBundle as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (_src: string, _branch: string | undefined, progress: (p: TimelineProgress) => void) =>
        new Promise<TimelineBundle>((resolve) => {
          onProgress = progress;
          resolveFetch = resolve;
        })
    );
    const f = fakeHandle();
    SCENE_HANDLE.value = f.handle as never;

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
    expect(LOADING_OVERLAY.value.activeStep).toBe(LoadingStep.Building);
    expect(BUILD_PROGRESS.value?.stages[0]).toBe(BuildStage.Assembling);
    expect(BUILD_PROGRESS.value?.percent).toBe(62);

    resolveFetch(BUNDLE);
    await entering;
    expect(LOADING_OVERLAY.value.activeStep).toBe(LoadingStep.Building);
    // Let the reveal frame run here: a leaked rAF hides the overlay out of a
    // later test instead.
    await nextFrame();
  });

  it('no-ops without a current source', async () => {
    CURRENT_SOURCE.value = null;
    const f = fakeHandle();
    SCENE_HANDLE.value = f.handle as never;
    await loadTimelineScene();
    expect(fetchTimelineBundle).not.toHaveBeenCalled();
    expect(TIMELINE_MODE.value).toBe(false);
    expect(LOADING_OVERLAY.value.visible).toBe(false);
  });

  it('surfaces a fetch error, leaves mode unset, and hides the overlay', async () => {
    (fetchTimelineBundle as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('boom')
    );
    const f = fakeHandle();
    SCENE_HANDLE.value = f.handle as never;
    await loadTimelineScene();
    expect(TIMELINE_MODE.value).toBe(false);
    expect(f.installScrubController).not.toHaveBeenCalled();
    expect(LOADING_OVERLAY.value.visible).toBe(false);
    expect(REBUILD_STATUS.value).toBe(RebuildStatus.Error);
  });

  it('still surfaces the error and hides the overlay when post-fetch work AND cleanup throw', async () => {
    // A throw inside the catch must not strand the overlay: the finally still
    // has to mark the error and take it down.
    (fetchTimelineBundle as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(BUNDLE);
    const f = fakeHandle();
    f.applyManifest.mockRejectedValue(new Error('pack failed'));
    f.uninstallScrubController.mockImplementation(() => {
      throw new Error('cleanup boom');
    });
    SCENE_HANDLE.value = f.handle as never;

    await loadTimelineScene();

    expect(TIMELINE_MODE.value).toBe(false);
    expect(LOADING_OVERLAY.value.visible).toBe(false);
    expect(REBUILD_STATUS.value).toBe(RebuildStatus.Error);
  });

  // The bundle caches per HEAD, so a Fresh scan that did not say so would be
  // answered from the very cache it asked to ignore.
  it('asks the history read to ignore its cache for a fresh scan', async () => {
    (fetchTimelineBundle as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(BUNDLE);
    SCENE_HANDLE.value = fakeHandle().handle as never;

    await loadTimelineScene({ inPlace: true, noCache: true });

    expect(fetchTimelineBundle).toHaveBeenCalledWith(
      's',
      undefined,
      expect.any(Function),
      expect.objectContaining({ noCache: true })
    );
  });

  it('leaves the cache alone on an ordinary refetch', async () => {
    (fetchTimelineBundle as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(BUNDLE);
    SCENE_HANDLE.value = fakeHandle().handle as never;

    await loadTimelineScene({ inPlace: true });

    expect(fetchTimelineBundle).toHaveBeenCalledWith(
      's',
      undefined,
      expect.any(Function),
      expect.objectContaining({ noCache: false })
    );
  });
});

describe('exitTimelineMode', () => {
  let restoreEventSource: () => void;
  beforeEach(() => {
    restoreEventSource = installEventSource();
    CURRENT_SOURCE.value = { src: 's', branch: undefined };
    TIMELINE_MODE.value = true;
    setScrubPos(2);
    TIMELINE_BUNDLE.value = BUNDLE;
  });
  afterEach(async () => {
    // The live-HEAD reload this suite starts parks on a stub stream that never
    // emits; uncancelled it outlives the test, holding SCAN_PROGRESS non-null.
    cancelLoad();
    await flush();
    expect(SCAN_PROGRESS.value).toBeNull();
    restoreEventSource();
    TIMELINE_MODE.value = false;
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
    TIMELINE_MODE.value = false;
  });

  it('is a pure signal flip — no source reload, scene-free', () => {
    TIMELINE_MODE.value = true;
    setScrubPos(2);
    TIMELINE_BUNDLE.value = BUNDLE;

    teardownTimelineMode();

    expect(TIMELINE_MODE.value).toBe(false);
    expect(SCRUB_POS.value).toBe(0);
    expect(TIMELINE_BUNDLE.value).toBeNull();
  });
});

describe('live poll suspends in Timeline mode', () => {
  let restoreEventSource: () => void;
  let fetchSpy: ReturnType<typeof vi.spyOn> | undefined;
  beforeEach(() => {
    restoreEventSource = installEventSource();
    CURRENT_SOURCE.value = { src: 's', branch: undefined };
    MANIFEST.value = { ...EMPTY_MANIFEST, content_signature: 'sig0' };
    SCAN_PROGRESS.value = null;
    TIMELINE_MODE.value = false;
  });
  afterEach(() => {
    LIVE_UPDATES.value = { ...LIVE_UPDATES.value, ENABLED: false };
    TIMELINE_MODE.value = false;
    fetchSpy?.mockRestore();
    restoreEventSource();
    vi.useRealTimers();
  });

  it('does not probe the signature endpoint while in Timeline mode, and resumes on exit', async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ content_signature: 'sig-changed' }),
    } as Response);
    LIVE_UPDATES.value = { ...LIVE_UPDATES.value, ENABLED: true, POLL_SECONDS: 1 };
    vi.useFakeTimers();

    const dispose = setupLiveUpdates();
    TIMELINE_MODE.value = true;

    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchSpy).not.toHaveBeenCalled();

    TIMELINE_MODE.value = false;
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchSpy).toHaveBeenCalled();

    dispose();
  });
});

describe('loadTimelineScene inPlace refetch', () => {
  beforeEach(() => {
    CURRENT_SOURCE.value = { src: 's', branch: undefined };
    // SOURCE_INFO reads the loaded manifest for the overlay's repo label.
    MANIFEST.value = { ...EMPTY_MANIFEST, content_signature: 'sig0' };
    TIMELINE_MODE.value = true;
    setScrubPos(2);
    TIMELINE_BUNDLE.value = BUNDLE;
    REBUILD_STATUS.value = RebuildStatus.Idle; // inPlace uses the footer (markRebuilding)
    REBUILD_DETAIL.value = null;
    LOADING_OVERLAY.value = { visible: false, showOpts: null, activeStep: null, stepTails: {} };
    (fetchTimelineBundle as unknown as ReturnType<typeof vi.fn>).mockReset();
  });
  afterEach(() => {
    TIMELINE_MODE.value = false;
    SCENE_HANDLE.value = null;
  });

  it('refetches the bundle with the current excludes, re-packs, and holds SCRUB_POS', async () => {
    const NEXT = {
      ...BUNDLE,
      unionManifest: { tree: { name: 'r2' }, stats: {}, repo: UNION_REPO },
    } as unknown as TimelineBundle;
    (fetchTimelineBundle as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(NEXT);
    const f = fakeHandle();
    SCENE_HANDLE.value = f.handle as never;

    await loadTimelineScene({ inPlace: true });

    expect(fetchTimelineBundle).toHaveBeenCalledWith(
      's',
      undefined,
      expect.any(Function),
      expect.objectContaining({ exclude: expect.any(Array) })
    );
    expect(TIMELINE_BUNDLE.value).toBe(NEXT);
    expect(f.applyManifest).toHaveBeenCalledWith(NEXT.unionManifest, [
      BuildStage.Assembling,
      BuildStage.Replay,
    ]);
    expect(f.installScrubController).toHaveBeenCalledTimes(1);
    expect(SCRUB_POS.value).toBe(2); // held at present, not reset
  });

  it('no-ops without a scene handle', async () => {
    SCENE_HANDLE.value = null;
    await loadTimelineScene({ inPlace: true });
    expect(fetchTimelineBundle).not.toHaveBeenCalled();
  });

  // An exclude edit refetches under a city that is already on screen: no
  // overlay, so the freshness readout is the only place the stages can show.
  it('reports its stages through the freshness readout when no overlay is asked for', async () => {
    let onProgress!: (p: TimelineProgress) => void;
    let resolveFetch!: (b: TimelineBundle) => void;
    (fetchTimelineBundle as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (_src: string, _branch: string | undefined, progress: (p: TimelineProgress) => void) =>
        new Promise<TimelineBundle>((resolve) => {
          onProgress = progress;
          resolveFetch = resolve;
        })
    );
    const f = fakeHandle();
    SCENE_HANDLE.value = f.handle as never;

    const refetching = loadTimelineScene({ inPlace: true });
    await flush();
    expect(LOADING_OVERLAY.value.visible).toBe(false);
    expect(REBUILD_STATUS.value).toBe(RebuildStatus.Rebuilding);

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
    let onProgress!: (p: TimelineProgress) => void;
    let resolveFetch!: (b: TimelineBundle) => void;
    (fetchTimelineBundle as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (_src: string, _branch: string | undefined, progress: (p: TimelineProgress) => void) =>
        new Promise<TimelineBundle>((resolve) => {
          onProgress = progress;
          resolveFetch = resolve;
        })
    );
    const f = fakeHandle();
    SCENE_HANDLE.value = f.handle as never;

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
    (fetchTimelineBundle as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (
        _src: string,
        _branch: string | undefined,
        _progress: unknown,
        opts: { signal: AbortSignal }
      ) =>
        new Promise<TimelineBundle>((_resolve, reject) => {
          opts.signal.addEventListener('abort', () => {
            const e = new Error('Timeline load aborted');
            e.name = 'AbortError';
            reject(e);
          });
        })
    );
    const f = fakeHandle();
    SCENE_HANDLE.value = f.handle as never;

    const refetching = loadTimelineScene({ inPlace: true, noCache: true, overlay: true });
    await flush();
    LOADING_CANCEL.value?.();
    await refetching;

    expect(LOADING_OVERLAY.value.visible).toBe(false);
    expect(TIMELINE_MODE.value).toBe(true); // still in Timeline
    expect(TIMELINE_BUNDLE.value).toBe(BUNDLE); // on the bundle it already had
    expect(f.applyManifest).not.toHaveBeenCalled();
    expect(REBUILD_STATUS.value).toBe(RebuildStatus.Idle); // nothing to unwind
  });
});

describe('exclude edit in Timeline routes to a bundle refetch (regression: #128)', () => {
  let restoreEventSource: () => void;
  beforeEach(() => {
    restoreEventSource = installEventSource();
    CURRENT_SOURCE.value = { src: 's', branch: undefined };
    MANIFEST.value = { ...EMPTY_MANIFEST, content_signature: 'sig0' };
    SCAN_PROGRESS.value = null;
    TIMELINE_MODE.value = true;
    setScrubPos(2);
    TIMELINE_BUNDLE.value = BUNDLE;
    EXCLUDES.value = {};
    (fetchTimelineBundle as unknown as ReturnType<typeof vi.fn>).mockReset();
    (fetchTimelineBundle as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(BUNDLE);
  });
  afterEach(() => {
    restoreEventSource();
    TIMELINE_MODE.value = false;
    SCENE_HANDLE.value = null;
    EXCLUDES.value = {};
  });

  it('refetches the union bundle with the new exclude and opens no live stream', async () => {
    const f = fakeHandle();
    SCENE_HANDLE.value = f.handle as never;
    const dispose = setupLiveUpdates();

    addExclude('vendor');
    await flush();

    expect(fetchTimelineBundle).toHaveBeenCalledTimes(1);
    const opts = (fetchTimelineBundle as unknown as ReturnType<typeof vi.fn>).mock.calls[0][3];
    expect(opts).toEqual(expect.objectContaining({ exclude: ['vendor'] }));
    expect(StubEventSource.instances.length).toBe(0); // Timeline must not fall back to a live re-scan
    dispose();
  });
});
