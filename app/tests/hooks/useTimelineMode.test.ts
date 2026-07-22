import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { enterTimelineMode, exitTimelineMode } from '@/hooks/useTimelineMode';
import { TIMELINE_MODE, SCRUB_POS, TIMELINE_BUNDLE } from '@/state/stores/timeline';
import { CURRENT_SOURCE } from '@/state/stores/source';
import { SCENE_HANDLE } from '@/state/stores/scene';
import { MANIFEST } from '@/state/stores/manifest';
import { LIVE_UPDATES } from '@/state/stores/settings/updates';
import { SCAN_PROGRESS } from '@/state/stores/scanProgress';
import { setupLiveUpdates } from '@/hooks/useManifestSource';
import type { TimelineBundle } from '@/types';

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
  const handle = {
    applyManifest,
    timeline: { installScrubController, uninstallScrubController, setStreetsTransparent },
  };
  return {
    handle,
    applyManifest,
    installScrubController,
    uninstallScrubController,
    setStreetsTransparent,
  };
}

describe('enterTimelineMode', () => {
  beforeEach(() => {
    CURRENT_SOURCE.value = { src: 's', branch: undefined };
    TIMELINE_MODE.value = false;
    SCRUB_POS.value = 0;
    TIMELINE_BUNDLE.value = null;
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

    expect(fetchTimelineBundle).toHaveBeenCalledWith('s', undefined);
    expect(f.applyManifest).toHaveBeenCalledTimes(1);
    expect(f.applyManifest).toHaveBeenCalledWith(BUNDLE.unionManifest);
    expect(f.setStreetsTransparent).toHaveBeenCalledWith(true);
    expect(f.installScrubController).toHaveBeenCalledTimes(1);
    expect(TIMELINE_BUNDLE.value).toBe(BUNDLE);
    expect(TIMELINE_MODE.value).toBe(true);
    expect(SCRUB_POS.value).toBe(2); // commits.length - 1 → start at present
  });

  it('no-ops without a current source', async () => {
    CURRENT_SOURCE.value = null;
    const f = fakeHandle();
    SCENE_HANDLE.value = f.handle as never;
    await enterTimelineMode();
    expect(fetchTimelineBundle).not.toHaveBeenCalled();
    expect(TIMELINE_MODE.value).toBe(false);
  });

  it('surfaces a fetch error and leaves mode unset', async () => {
    (fetchTimelineBundle as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('boom')
    );
    const f = fakeHandle();
    SCENE_HANDLE.value = f.handle as never;
    await enterTimelineMode();
    expect(TIMELINE_MODE.value).toBe(false);
    expect(f.installScrubController).not.toHaveBeenCalled();
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
  });
  afterEach(() => {
    (globalThis as unknown as { EventSource: unknown }).EventSource = originalEventSource;
    TIMELINE_MODE.value = false;
    SCENE_HANDLE.value = null;
  });

  it('leaves mode, uninstalls the controller, un-transparents streets, and reloads live HEAD', async () => {
    const f = fakeHandle();
    SCENE_HANDLE.value = f.handle as never;

    exitTimelineMode();

    expect(TIMELINE_MODE.value).toBe(false);
    expect(f.uninstallScrubController).toHaveBeenCalledTimes(1);
    expect(f.setStreetsTransparent).toHaveBeenCalledWith(false);
    await flush();
    expect(StubEventSource.instances.length).toBeGreaterThan(0); // live HEAD reload started
    expect(new URL(StubEventSource.instances[0].url).searchParams.get('ref')).toBeNull();
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
