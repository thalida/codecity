import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadSource, setupLiveUpdates } from '@/hooks/useManifestSource';
import { CURRENT_SOURCE } from '@/state/stores/source';
import { MANIFEST } from '@/state/stores/manifest';
import { EXCLUDES, addExclude } from '@/state/stores/excludes';

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

// Minimal manifest-complete payload so loadSource commits the source. The
// stream reader treats a `manifest-complete` event as terminal (it closes the
// EventSource itself) — no separate "done" event exists on the wire.
const MANIFEST_JSON = JSON.stringify({
  manifest: {
    signature: 'sig0',
    tree_signature: 't0',
    tree: { name: 'r', type: 'directory', path: '.', children: [] },
    repo: {},
  },
});

describe('exclude-driven re-fetch', () => {
  let original: typeof EventSource;
  beforeEach(() => {
    original = globalThis.EventSource;
    StubEventSource.instances = [];
    (globalThis as unknown as { EventSource: unknown }).EventSource = StubEventSource;
    EXCLUDES.value = {};
    CURRENT_SOURCE.value = null;
    MANIFEST.value = { tree: {} } as never;
  });
  afterEach(() => {
    (globalThis as unknown as { EventSource: unknown }).EventSource = original;
  });

  it('re-fetches the loaded source with the exclude param when an exclude is added', async () => {
    const load = loadSource({ src: 's', branch: undefined });
    await flush();
    StubEventSource.instances[0].emit('manifest-complete', MANIFEST_JSON);
    await load;
    expect(CURRENT_SOURCE.value?.src).toBe('s');

    const dispose = setupLiveUpdates();
    const before = StubEventSource.instances.length;
    addExclude('vendor');
    await flush();
    const fresh = StubEventSource.instances.slice(before);
    expect(fresh.length).toBeGreaterThan(0);
    expect(new URL(fresh[0].url).searchParams.getAll('exclude')).toEqual(['vendor']);
    dispose();
  });

  it('does not re-fetch merely because the source switched', async () => {
    const dispose = setupLiveUpdates();
    const before = StubEventSource.instances.length;
    CURRENT_SOURCE.value = { src: 's2', branch: undefined }; // switch, no exclude edit
    await flush();
    expect(StubEventSource.instances.length).toBe(before);
    dispose();
  });
});
