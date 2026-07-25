import { test, expect, describe, it } from 'vitest';
import { timelineUrlFor, fetchTimelineBundle } from '@/api/timeline';
import type { TimelineBundle } from '@/types';

test('timelineUrlFor builds the endpoint URL with src', () => {
  const u = timelineUrlFor('/repo', undefined);
  expect(u).toContain('/api/timeline');
  expect(u).toContain('src=%2Frepo');
});

test('timelineUrlFor emits one repeated exclude param per path', () => {
  const u = timelineUrlFor('/repo', undefined, ['a.txt', 'secrets']);
  expect(u).toContain('exclude=a.txt');
  expect(u).toContain('exclude=secrets');
});

// Minimal EventSource stub, mirrors tests/api/manifest.test.ts.
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
  emit(name: string, data?: string): void {
    const e = data === undefined ? {} : { data };
    for (const h of this.listeners[name] ?? []) h(e);
  }
}

function makeES(): { ctor: typeof EventSource; last: () => StubEventSource } {
  let last: StubEventSource | undefined;
  const ctor = function (url: string): StubEventSource {
    last = new StubEventSource(url);
    return last;
  } as unknown as typeof EventSource;
  return { ctor, last: () => last! };
}

const BUNDLE = {
  commits: [{ sha: 'a' }],
  unionManifest: { tree: { name: 'r' } },
  deltas: [],
  blobLines: {},
  blobSizes: {},
  note: null,
} as unknown as TimelineBundle;

describe('fetchTimelineBundle (SSE)', () => {
  it('reports progress events and resolves with the bundle on timeline-complete', async () => {
    const { ctor, last } = makeES();
    const progress: unknown[] = [];
    const promise = fetchTimelineBundle('/repo', undefined, (p) => progress.push(p), {
      EventSourceImpl: ctor,
    });
    const es = last();
    es.emit('timeline-progress', JSON.stringify({ stage: 'history', commits: 42 }));
    es.emit('timeline-progress', JSON.stringify({ stage: 'blobs', blobsDone: 5, blobsTotal: 10 }));
    es.emit('timeline-complete', JSON.stringify({ bundle: BUNDLE }));

    const bundle = await promise;
    expect(bundle).toEqual(BUNDLE);
    expect(progress).toEqual([
      { stage: 'history', commits: 42 },
      { stage: 'blobs', blobsDone: 5, blobsTotal: 10 },
    ]);
    expect(es.closed).toBe(true);
  });

  it('rejects on a server-sent error event', async () => {
    const { ctor, last } = makeES();
    const promise = fetchTimelineBundle('/repo', undefined, undefined, { EventSourceImpl: ctor });
    last().emit('error', JSON.stringify({ error: 'boom' }));
    await expect(promise).rejects.toThrow(/boom/);
    expect(last().closed).toBe(true);
  });

  it('rejects on a transport-level error (bare error event, no data)', async () => {
    const { ctor, last } = makeES();
    const promise = fetchTimelineBundle('/repo', undefined, undefined, { EventSourceImpl: ctor });
    last().emit('error');
    await expect(promise).rejects.toThrow(/connection failed/i);
  });

  it('skips straight to timeline-complete on a warm cache hit (no progress events)', async () => {
    const { ctor, last } = makeES();
    const progress: unknown[] = [];
    const promise = fetchTimelineBundle('/repo', undefined, (p) => progress.push(p), {
      EventSourceImpl: ctor,
    });
    last().emit('timeline-complete', JSON.stringify({ bundle: BUNDLE }));
    const bundle = await promise;
    expect(bundle).toEqual(BUNDLE);
    expect(progress).toEqual([]);
  });
});
