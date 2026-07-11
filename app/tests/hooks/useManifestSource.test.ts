import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadSource, cancelLoad } from '@/hooks/useManifestSource';
import { SOURCE_ERROR, CURRENT_SOURCE } from '@/state/stores/source';
import { MANIFEST } from '@/state/stores/manifest';

// EventSource stub with driveable events: records listeners so a test can emit
// a named SSE event (e.g. a `manifest-partial` skeleton), and records
// instances so a test can assert the stream was closed on abort.
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

describe('useManifestSource loadSource cancellation', () => {
  let originalEventSource: typeof EventSource;

  beforeEach(() => {
    originalEventSource = globalThis.EventSource;
    StubEventSource.instances = [];
    (globalThis as unknown as { EventSource: unknown }).EventSource = StubEventSource;
    SOURCE_ERROR.value = null;
  });

  afterEach(() => {
    (globalThis as unknown as { EventSource: unknown }).EventSource = originalEventSource;
  });

  it('canceling a load leaves SOURCE_ERROR null and CURRENT_SOURCE unchanged', async () => {
    const before = CURRENT_SOURCE.value;

    const p = loadSource({ src: 'https://github.com/o/r' }); // starts the load
    cancelLoad(); // aborts via loadController before any event arrives

    await p;

    expect(SOURCE_ERROR.value).toBeNull();
    expect(CURRENT_SOURCE.value).toBe(before);
    expect(StubEventSource.instances[0]?.closed).toBe(true);
  });

  it('canceling AFTER a skeleton manifest does not commit it as CURRENT_SOURCE', async () => {
    const before = CURRENT_SOURCE.value;

    const p = loadSource({ src: 'https://github.com/o/r' });
    await flush(); // let the for-await attach its event listeners

    // Skeleton arrives, then the user cancels before the final manifest. An
    // aborted stream ends done (not a throw), so pumpManifestStream RETURNS the
    // skeleton — the success path must still refuse to commit it.
    StubEventSource.instances[0]!.emit(
      'manifest-partial',
      JSON.stringify({ manifest: { root: '/r', tree: { type: 'directory' }, signature: 'sig' } })
    );
    await flush();
    cancelLoad();

    await p;

    expect(CURRENT_SOURCE.value).toBe(before); // NOT committed
    expect(SOURCE_ERROR.value).toBeNull(); // cancel is not an error
    expect(StubEventSource.instances[0]?.closed).toBe(true);
  });

  it('canceling AFTER a skeleton rolls MANIFEST back to the prior city', async () => {
    // City A is already applied (source unchanged throughout this load of B).
    const cityA = { root: '/a', tree: { type: 'directory' }, signature: 'sig-a' };
    MANIFEST.value = cityA;
    const before = CURRENT_SOURCE.value;

    const p = loadSource({ src: 'https://github.com/o/b' });
    await flush(); // let the for-await attach its event listeners

    // B's skeleton streams into MANIFEST (behind the overlay)...
    StubEventSource.instances[0]!.emit(
      'manifest-partial',
      JSON.stringify({ manifest: { root: '/b', tree: { type: 'directory' }, signature: 'sig-b' } })
    );
    await flush();
    expect(MANIFEST.value).not.toBe(cityA); // sanity: B's skeleton IS applied mid-load

    cancelLoad(); // ...then the user cancels before B's final arrives
    await p;

    expect(MANIFEST.value).toBe(cityA); // rolled back to city A
    expect(CURRENT_SOURCE.value).toBe(before); // never committed B
    expect(SOURCE_ERROR.value).toBeNull(); // cancel is not an error
  });
});
