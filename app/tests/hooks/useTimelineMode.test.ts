import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { enterTimelineMode, exitTimelineMode, teardownTimelineMode } from '@/hooks/useTimelineMode';
import { TIMELINE_MODE, SCRUB_POS, TIMELINE_BUNDLE } from '@/state/stores/timeline';
import { CURRENT_SOURCE } from '@/state/stores/source';
import { SCENE_HANDLE } from '@/state/stores/scene';
import { MANIFEST, REBUILD_STATUS, RebuildStatus } from '@/state/stores/manifest';
import { LOADING_OVERLAY } from '@/state/stores/ui';
import { LoadingStep } from '@/constants/loadingSteps';
import { LIVE_UPDATES } from '@/state/stores/settings/updates';
import { SCAN_PROGRESS } from '@/state/stores/scanProgress';
import { setupLiveUpdates } from '@/hooks/useManifestSource';
import type { TimelineBundle, TimelineProgress } from '@/types';

// jsdom's rAF fires for real on a ~16ms timer; wait for one tick to observe
// the post-paint hide (mirrors filePreviewPane.test.tsx's rAF handling).
const nextFrame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));

vi.mock('@/api/timeline', () => ({ fetchTimelineBundle: vi.fn() }));
import { fetchTimelineBundle } from '@/api/timeline';

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

// EventSource stub — exit reloads live HEAD via loadSource → streamManifest.
class StubEventSource {
  static instances: StubEventSource[] = [];
  closed = false;
  constructor(public url: string) {
    StubEventSource.instances.push(this);
  }
  addEventListener(): void {}
  close(): void {
    this.closed = true;
  }
}

const BUNDLE = {
  commits: [{ sha: 'a' }, { sha: 'b' }, { sha: 'c' }],
  unionManifest: { tree: { name: 'r' }, stats: {} },
  deltas: [],
  blobLines: {},
  note: null,
} as unknown as TimelineBundle;

function fakeHandle() {
  const applyManifest = vi.fn().mockResolvedValue(undefined);
  const installScrubController = vi.fn();
  const uninstallScrubController = vi.fn();
  const setStreetsTransparent = vi.fn();
  const setFootprintsTransparent = vi.fn();
  const handle = {
    applyManifest,
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
    installScrubController,
    uninstallScrubController,
    setStreetsTransparent,
    setFootprintsTransparent,
  };
}

describe('enterTimelineMode', () => {
  beforeEach(() => {
    CURRENT_SOURCE.value = { src: 's', branch: undefined };
    TIMELINE_MODE.value = false;
    SCRUB_POS.value = 0;
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

    await enterTimelineMode();

    expect(fetchTimelineBundle).toHaveBeenCalledWith(
      's',
      undefined,
      expect.any(Function),
      expect.objectContaining({ signal: expect.any(AbortSignal), exclude: expect.any(Array) })
    );
    expect(f.applyManifest).toHaveBeenCalledTimes(1);
    expect(f.applyManifest).toHaveBeenCalledWith(BUNDLE.unionManifest);
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

  it('shows the full loading overlay (not just the footer) and drives it through TimelineLoading then Building', async () => {
    let resolveFetch!: (b: TimelineBundle) => void;
    (fetchTimelineBundle as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      () =>
        new Promise<TimelineBundle>((resolve) => {
          resolveFetch = resolve;
        })
    );
    const f = fakeHandle();
    SCENE_HANDLE.value = f.handle as never;

    const entering = enterTimelineMode();
    await flush();
    expect(LOADING_OVERLAY.value.visible).toBe(true);
    expect(LOADING_OVERLAY.value.activeStep).toBe(LoadingStep.TimelineLoading);

    resolveFetch(BUNDLE);
    await entering;
    expect(LOADING_OVERLAY.value.activeStep).toBe(LoadingStep.Building);
    // Not hidden yet — reveal waits for the first painted frame.
    expect(LOADING_OVERLAY.value.visible).toBe(true);

    await nextFrame();
    expect(LOADING_OVERLAY.value.visible).toBe(false);
  });

  it('drives the TimelineLoading step tail from progress events, then clears it for Building', async () => {
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

    const entering = enterTimelineMode();
    await flush();

    onProgress({ stage: 'history', commits: 42 });
    expect(LOADING_OVERLAY.value.stepTails[LoadingStep.TimelineLoading]).toBe('42 commits');

    onProgress({ stage: 'blobs', blobsDone: 5, blobsTotal: 10 });
    expect(LOADING_OVERLAY.value.stepTails[LoadingStep.TimelineLoading]).toBe('5/10 files');

    resolveFetch(BUNDLE);
    await entering;
    expect(LOADING_OVERLAY.value.stepTails[LoadingStep.TimelineLoading]).toBeNull();
    expect(LOADING_OVERLAY.value.activeStep).toBe(LoadingStep.Building);
  });

  it('no-ops without a current source', async () => {
    CURRENT_SOURCE.value = null;
    const f = fakeHandle();
    SCENE_HANDLE.value = f.handle as never;
    await enterTimelineMode();
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
    await enterTimelineMode();
    expect(TIMELINE_MODE.value).toBe(false);
    expect(f.installScrubController).not.toHaveBeenCalled();
    expect(LOADING_OVERLAY.value.visible).toBe(false);
    expect(REBUILD_STATUS.value).toBe(RebuildStatus.Error);
  });

  it('still surfaces the error and hides the overlay when post-fetch work AND cleanup throw', async () => {
    // A throw after the fetch resolves (applyManifest) lands in catch; if a
    // cleanup call there ALSO throws, markError + hideLoadingOverlay must still
    // run (the finally) — otherwise the overlay is stranded, no error shown.
    (fetchTimelineBundle as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(BUNDLE);
    const f = fakeHandle();
    f.applyManifest.mockRejectedValue(new Error('pack failed'));
    f.uninstallScrubController.mockImplementation(() => {
      throw new Error('cleanup boom');
    });
    SCENE_HANDLE.value = f.handle as never;

    await enterTimelineMode();

    expect(TIMELINE_MODE.value).toBe(false);
    expect(LOADING_OVERLAY.value.visible).toBe(false);
    expect(REBUILD_STATUS.value).toBe(RebuildStatus.Error);
  });
});

describe('exitTimelineMode', () => {
  let originalEventSource: typeof EventSource;
  beforeEach(() => {
    originalEventSource = globalThis.EventSource;
    StubEventSource.instances = [];
    (globalThis as unknown as { EventSource: unknown }).EventSource = StubEventSource;
    CURRENT_SOURCE.value = { src: 's', branch: undefined };
    TIMELINE_MODE.value = true;
    SCRUB_POS.value = 2;
    TIMELINE_BUNDLE.value = BUNDLE;
  });
  afterEach(() => {
    (globalThis as unknown as { EventSource: unknown }).EventSource = originalEventSource;
    TIMELINE_MODE.value = false;
    SCENE_HANDLE.value = null;
  });

  // The scene-side teardown (uninstall controller, un-transparent streets/footprints,
  // restore trees) is owned by the city-layer effect in city/index.ts, which reacts
  // to TIMELINE_MODE — see tests/city/index.test.ts. This test covers the hook's contract.
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
    SCRUB_POS.value = 2;
    TIMELINE_BUNDLE.value = BUNDLE;

    teardownTimelineMode();

    expect(TIMELINE_MODE.value).toBe(false);
    expect(SCRUB_POS.value).toBe(0);
    expect(TIMELINE_BUNDLE.value).toBeNull();
  });
});

describe('live poll suspends in Timeline mode', () => {
  let originalEventSource: typeof EventSource;
  let fetchSpy: ReturnType<typeof vi.spyOn> | undefined;
  beforeEach(() => {
    originalEventSource = globalThis.EventSource;
    StubEventSource.instances = [];
    (globalThis as unknown as { EventSource: unknown }).EventSource = StubEventSource;
    CURRENT_SOURCE.value = { src: 's', branch: undefined };
    MANIFEST.value = { content_signature: 'sig0', tree: {} } as never;
    SCAN_PROGRESS.value = null;
    TIMELINE_MODE.value = false;
  });
  afterEach(() => {
    LIVE_UPDATES.value = { ...LIVE_UPDATES.value, ENABLED: false };
    TIMELINE_MODE.value = false;
    fetchSpy?.mockRestore();
    (globalThis as unknown as { EventSource: unknown }).EventSource = originalEventSource;
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
