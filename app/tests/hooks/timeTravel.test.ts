import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TIME_TRAVEL_REF } from '@/state/stores/timeTravel';
import { loadSource, loadRef, exitTimeTravel, setupLiveUpdates } from '@/hooks/useManifestSource';
import { CURRENT_SOURCE } from '@/state/stores/source';
import { MANIFEST } from '@/state/stores/manifest';
import { LIVE_UPDATES } from '@/state/stores/settings/updates';
import { SCAN_PROGRESS } from '@/state/stores/scanProgress';
import { REBUILD_STATUS, RebuildStatus } from '@/state/stores/manifest';

// EventSource stub mirrors useManifestSource.test.ts: records listeners so a
// test can emit a named SSE event and records instances for URL assertions.
class StubEventSource {
  static instances: StubEventSource[] = [];
  closed = false;
  private listeners: Record<string, ((e: unknown) => void)[]> = {};
  constructor(public url: string) {
    StubEventSource.instances.push(this);
  }
  addEventListener(name: string, handler: (e: unknown) => void): void {
    (this.listeners[name] ??= []).push(handler);
  }
  close(): void {
    this.closed = true;
  }
  emit(name: string, data: string): void {
    for (const h of this.listeners[name] ?? []) h({ data });
  }
}
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const MANIFEST_JSON = (sig: string): string =>
  JSON.stringify({
    manifest: {
      content_signature: sig,
      structure_signature: 't0',
      layout_signature: 't0',
      tree: { name: 'r', type: 'directory', path: '.', children: [] },
      repo: {},
    },
  });

describe('TIME_TRAVEL_REF store', () => {
  it('defaults to null (live)', () => {
    expect(TIME_TRAVEL_REF.value).toBeNull();
  });
});

describe('live-update poll suspends during time-travel', () => {
  let originalEventSource: typeof EventSource;
  let fetchSpy: ReturnType<typeof vi.spyOn> | undefined;

  beforeEach(() => {
    originalEventSource = globalThis.EventSource;
    StubEventSource.instances = [];
    (globalThis as unknown as { EventSource: unknown }).EventSource = StubEventSource;
    CURRENT_SOURCE.value = null;
    MANIFEST.value = { tree: {} } as never;
    TIME_TRAVEL_REF.value = null;
  });

  afterEach(() => {
    LIVE_UPDATES.value = { ...LIVE_UPDATES.value, ENABLED: false };
    TIME_TRAVEL_REF.value = null;
    fetchSpy?.mockRestore();
    (globalThis as unknown as { EventSource: unknown }).EventSource = originalEventSource;
    vi.useRealTimers();
  });

  it('does not hit the signature endpoint while a ref is pinned, and resumes once cleared', async () => {
    // Load a real source (real timers) so tick() has a CURRENT_SOURCE + non-empty
    // MANIFEST, THEN switch to fake timers to drive the poll interval directly.
    const load = loadSource({ src: 's', branch: undefined });
    await flush();
    StubEventSource.instances[0].emit('manifest-complete', MANIFEST_JSON('sig0'));
    await load;
    expect(CURRENT_SOURCE.value?.src).toBe('s');

    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ content_signature: 'sig-changed' }),
    } as Response);
    LIVE_UPDATES.value = { ...LIVE_UPDATES.value, ENABLED: true, POLL_SECONDS: 1 };
    vi.useFakeTimers();

    const dispose = setupLiveUpdates();
    TIME_TRAVEL_REF.value = 'abc1234'; // pin to a past ref

    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchSpy).not.toHaveBeenCalled(); // tick suspended: no signature probe fired

    TIME_TRAVEL_REF.value = null; // back to live
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchSpy).toHaveBeenCalled(); // poll resumed

    dispose();
  });
});

describe('loadRef / exitTimeTravel', () => {
  let originalEventSource: typeof EventSource;

  beforeEach(() => {
    originalEventSource = globalThis.EventSource;
    StubEventSource.instances = [];
    (globalThis as unknown as { EventSource: unknown }).EventSource = StubEventSource;
    CURRENT_SOURCE.value = null;
    MANIFEST.value = { tree: {} } as never;
    TIME_TRAVEL_REF.value = null;
  });

  afterEach(() => {
    (globalThis as unknown as { EventSource: unknown }).EventSource = originalEventSource;
    TIME_TRAVEL_REF.value = null;
    REBUILD_STATUS.value = RebuildStatus.Idle;
  });

  it('marks REBUILD_STATUS Rebuilding on start and Error on a failed ref load', async () => {
    const load = loadSource({ src: 's', branch: undefined });
    await flush();
    StubEventSource.instances[0].emit('manifest-complete', MANIFEST_JSON('sig0'));
    await load;
    REBUILD_STATUS.value = RebuildStatus.Idle;

    const p = loadRef('abc1234');
    await flush();
    expect(REBUILD_STATUS.value).toBe(RebuildStatus.Rebuilding); // footer feedback during the fetch

    const refStream = StubEventSource.instances[StubEventSource.instances.length - 1];
    refStream.emit('error', JSON.stringify({ error: 'boom' }));
    await p;
    expect(REBUILD_STATUS.value).toBe(RebuildStatus.Error); // footer error, no source picker
  });

  it('applies the ref manifest and sets TIME_TRAVEL_REF without touching CURRENT_SOURCE', async () => {
    const load = loadSource({ src: 's', branch: undefined });
    await flush();
    StubEventSource.instances[0].emit('manifest-complete', MANIFEST_JSON('sig0'));
    await load;
    const committed = CURRENT_SOURCE.value;

    const p = loadRef('abc1234');
    await flush();
    const refStream = StubEventSource.instances[StubEventSource.instances.length - 1];
    expect(new URL(refStream.url).searchParams.get('ref')).toBe('abc1234');
    refStream.emit('manifest-complete', MANIFEST_JSON('sig-past'));
    await p;

    expect((MANIFEST.value as { content_signature?: string }).content_signature).toBe('sig-past');
    expect(TIME_TRAVEL_REF.value).toBe('abc1234');
    expect(CURRENT_SOURCE.value).toBe(committed); // unchanged
  });

  it('resets SCAN_PROGRESS to null after a successful ref load (no stuck loading overlay)', async () => {
    const load = loadSource({ src: 's', branch: undefined });
    await flush();
    StubEventSource.instances[0].emit('manifest-complete', MANIFEST_JSON('sig0'));
    await load;
    expect(SCAN_PROGRESS.value).toBeNull(); // loadSource already tears its own overlay down

    const p = loadRef('abc1234');
    await flush();
    const refStream = StubEventSource.instances[StubEventSource.instances.length - 1];
    refStream.emit('manifest-complete', MANIFEST_JSON('sig-past'));
    await p;

    expect(SCAN_PROGRESS.value).toBeNull();
  });

  it('exitTimeTravel clears the pin and reloads the committed source at HEAD', async () => {
    const load = loadSource({ src: 's', branch: undefined });
    await flush();
    StubEventSource.instances[0].emit('manifest-complete', MANIFEST_JSON('sig0'));
    await load;

    const p = loadRef('abc1234');
    await flush();
    StubEventSource.instances[StubEventSource.instances.length - 1].emit(
      'manifest-complete',
      MANIFEST_JSON('sig-past')
    );
    await p;
    expect(TIME_TRAVEL_REF.value).toBe('abc1234');

    const before = StubEventSource.instances.length;
    exitTimeTravel();
    expect(TIME_TRAVEL_REF.value).toBeNull(); // cleared synchronously
    await flush();
    const fresh = StubEventSource.instances.slice(before);
    expect(fresh.length).toBeGreaterThan(0);
    expect(new URL(fresh[0].url).searchParams.get('ref')).toBeNull(); // HEAD, not the pinned ref
  });

  it('loadSource (a source switch) clears a pin left over from a different source', async () => {
    const load = loadSource({ src: 's', branch: undefined });
    await flush();
    StubEventSource.instances[0].emit('manifest-complete', MANIFEST_JSON('sig0'));
    await load;

    const p = loadRef('abc1234');
    await flush();
    StubEventSource.instances[StubEventSource.instances.length - 1].emit(
      'manifest-complete',
      MANIFEST_JSON('sig-past')
    );
    await p;
    expect(TIME_TRAVEL_REF.value).toBe('abc1234');

    const switchLoad = loadSource({ src: 'other', branch: undefined });
    await flush();
    StubEventSource.instances[StubEventSource.instances.length - 1].emit(
      'manifest-complete',
      MANIFEST_JSON('sig-other')
    );
    await switchLoad;

    expect(TIME_TRAVEL_REF.value).toBeNull();
  });
});
