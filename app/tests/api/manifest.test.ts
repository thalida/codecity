import { describe, it, expect } from 'vitest';
import { streamManifest, ScanPhase, type ScanStreamEvent } from '@/api/manifest';

// Minimal EventSource stub: records listeners; the test drives events via emit().
class StubEventSource {
  url: string;
  closed = false;
  private listeners: Record<string, ((e: unknown) => void)[]> = {};
  constructor(url: string) {
    this.url = url;
  }
  addEventListener(name: string, handler: (e: unknown) => void): void {
    (this.listeners[name] ??= []).push(handler);
  }
  close(): void {
    this.closed = true;
  }
  /** Dispatch a server-sent named event (with JSON data) or, when data is
   *  omitted, a transport-level error (bare event, no data). */
  emit(name: string, data?: string): void {
    const e = data === undefined ? {} : { data };
    for (const h of this.listeners[name] ?? []) h(e);
  }
}

/** Build an injectable ctor that captures the constructed stub for driving. */
function makeES(): { ctor: typeof EventSource; last: () => StubEventSource } {
  let last: StubEventSource | undefined;
  const ctor = function (url: string): StubEventSource {
    last = new StubEventSource(url);
    return last;
  } as unknown as typeof EventSource;
  return { ctor, last: () => last! };
}

const fakeManifest = { root: '/r', tree: { type: 'directory' } };

describe('streamManifest (EventSource)', () => {
  it('maps named SSE events to ScanStreamEvents in order and stops after manifest-complete', async () => {
    const { ctor, last } = makeES();
    const it = streamManifest('/api/manifest?src=x', ctor)[Symbol.asyncIterator]();
    const es = last();
    es.emit('scan-progress', JSON.stringify({ display_root: 'x', files_scanned: 3 }));
    es.emit('manifest-partial', JSON.stringify({ manifest: fakeManifest }));
    es.emit('manifest-complete', JSON.stringify({ manifest: fakeManifest }));

    const a = await it.next();
    expect(a.value).toEqual({ phase: ScanPhase.ScanProgress, display_root: 'x', files_scanned: 3 });
    const b = await it.next();
    expect((b.value as ScanStreamEvent).phase).toBe(ScanPhase.PartialManifest);
    const c = await it.next();
    expect((c.value as ScanStreamEvent).phase).toBe(ScanPhase.CompleteManifest);
    const end = await it.next();
    expect(end.done).toBe(true);
    expect(es.closed).toBe(true);
  });

  it('maps a clone-progress event with display_root', async () => {
    const { ctor, last } = makeES();
    const it = streamManifest('/api/manifest', ctor)[Symbol.asyncIterator]();
    last().emit('clone-progress', JSON.stringify({ display_root: 'https://example.com/foo.git' }));
    const a = await it.next();
    const ev = a.value as ScanStreamEvent;
    expect(ev.phase).toBe(ScanPhase.CloneProgress);
    // Discriminator narrow — display_root must be on the clone-progress variant
    // of ScanStreamEvent, not reached through a cast that would hide drift.
    if (ev.phase !== ScanPhase.CloneProgress) throw new Error('expected clone-progress');
    expect(ev.display_root).toBe('https://example.com/foo.git');
  });

  it('emits a terminal Error event for a server-sent error', async () => {
    const { ctor, last } = makeES();
    const it = streamManifest('/api/manifest', ctor)[Symbol.asyncIterator]();
    last().emit('error', JSON.stringify({ error: 'boom' }));
    const a = await it.next();
    expect(a.value).toEqual({ phase: ScanPhase.Error, error: 'boom' });
    expect((await it.next()).done).toBe(true);
    expect(last().closed).toBe(true);
  });

  it('rejects on a transport-level error (bare error event, no data)', async () => {
    const { ctor, last } = makeES();
    const it = streamManifest('/api/manifest', ctor)[Symbol.asyncIterator]();
    last().emit('error'); // no data → connection failure
    await expect(it.next()).rejects.toThrow(/connection failed/i);
  });

  it('rejects on a malformed event payload instead of hanging forever', async () => {
    const { ctor, last } = makeES();
    const it = streamManifest('/api/manifest', ctor)[Symbol.asyncIterator]();
    last().emit('manifest-partial', '{not valid json'); // truncated/garbage frame
    await expect(it.next()).rejects.toThrow(/malformed/i);
  });
});
