import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadSource, cancelLoad } from '@/hooks/useManifestSource';
import { SOURCE_ERROR, CURRENT_SOURCE } from '@/state/stores/source';

// Minimal EventSource stub that never emits — the load stays pending until
// canceled, so this test exercises exactly the abort path (no manifest ever
// arrives) rather than racing a real network response.
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
});
