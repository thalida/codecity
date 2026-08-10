import { describe, it, expect } from 'vitest';
import { streamManifest, ScanPhase, type ScanStreamEvent } from '@/api/manifest';

// Minimal EventSource stub: records listeners; the test drives events via emit().
import { makeES } from '../_helpers/eventSource';

const fakeManifest = { root: '/r', tree: { type: 'directory' } };

describe('streamManifest (EventSource)', () => {
  it('maps named SSE events to ScanStreamEvents in order and stops after manifest-complete', async () => {
    const { ctor, last } = makeES();
    const it = streamManifest('/api/manifest?src=x', { EventSourceImpl: ctor })[
      Symbol.asyncIterator
    ]();
    const es = last();
    es.emit('scan-progress', JSON.stringify({ label: 'x', files_scanned: 3 }));
    es.emit('manifest-partial', JSON.stringify({ manifest: fakeManifest }));
    es.emit('manifest-complete', JSON.stringify({ manifest: fakeManifest }));

    const a = await it.next();
    expect(a.value).toEqual({ phase: ScanPhase.ScanProgress, label: 'x', files_scanned: 3 });
    const b = await it.next();
    expect((b.value as ScanStreamEvent).phase).toBe(ScanPhase.PartialManifest);
    const c = await it.next();
    expect((c.value as ScanStreamEvent).phase).toBe(ScanPhase.CompleteManifest);
    const end = await it.next();
    expect(end.done).toBe(true);
    expect(es.closed).toBe(true);
  });

  it('maps a clone-progress event with a label', async () => {
    const { ctor, last } = makeES();
    const it = streamManifest('/api/manifest', { EventSourceImpl: ctor })[Symbol.asyncIterator]();
    last().emit('clone-progress', JSON.stringify({ label: 'example/foo' }));
    const a = await it.next();
    const ev = a.value as ScanStreamEvent;
    expect(ev.phase).toBe(ScanPhase.CloneProgress);
    // Discriminator narrow — label must be on the clone-progress variant of
    // ScanStreamEvent, not reached through a cast that would hide drift.
    if (ev.phase !== ScanPhase.CloneProgress) throw new Error('expected clone-progress');
    expect(ev.label).toBe('example/foo');
  });

  it('emits a terminal Error event for a server-sent error', async () => {
    const { ctor, last } = makeES();
    const it = streamManifest('/api/manifest', { EventSourceImpl: ctor })[Symbol.asyncIterator]();
    last().emit('error', JSON.stringify({ error: 'boom' }));
    const a = await it.next();
    expect(a.value).toEqual({ phase: ScanPhase.Error, error: 'boom' });
    expect((await it.next()).done).toBe(true);
    expect(last().closed).toBe(true);
  });

  it('rejects on a transport-level error (bare error event, no data)', async () => {
    const { ctor, last } = makeES();
    const it = streamManifest('/api/manifest', { EventSourceImpl: ctor })[Symbol.asyncIterator]();
    last().emit('error'); // no data → connection failure
    await expect(it.next()).rejects.toThrow(/connection failed/i);
  });

  it('rejects on a malformed event payload instead of hanging forever', async () => {
    const { ctor, last } = makeES();
    const it = streamManifest('/api/manifest', { EventSourceImpl: ctor })[Symbol.asyncIterator]();
    last().emit('manifest-partial', '{not valid json'); // truncated/garbage frame
    await expect(it.next()).rejects.toThrow(/malformed/i);
  });

  it('ends iteration when the signal aborts (no more events delivered)', async () => {
    const { ctor, last } = makeES();
    const ac = new AbortController();
    const it = streamManifest('/api/manifest', {
      signal: ac.signal,
      EventSourceImpl: ctor,
    })[Symbol.asyncIterator]();
    const next = it.next(); // pending — no events yet
    ac.abort();
    const r = await next;
    expect(r.done).toBe(true);
    expect(last().closed).toBe(true); // EventSource was closed on abort
  });

  it('ends immediately when the signal is already aborted before iteration', async () => {
    const { ctor, last } = makeES();
    const ac = new AbortController();
    ac.abort(); // aborted BEFORE the iterator is created
    const it = streamManifest('/api/manifest', {
      signal: ac.signal,
      EventSourceImpl: ctor,
    })[Symbol.asyncIterator]();
    // The abort-wiring block runs after finish() is declared, so an
    // already-aborted signal closes the stream at iterator-creation time
    // without a TDZ ReferenceError.
    expect(last().closed).toBe(true);
    const r = await it.next();
    expect(r.done).toBe(true);
  });
});
