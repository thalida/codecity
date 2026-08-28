import { test, expect, describe, it } from 'vitest';
import { makeES } from '../_helpers/eventSource';
import { createClient } from '@/city/client/index';
import type { TimelineBundle } from '@/city/types/timeline';

// The app used to hand these its own singleton; the client under test is
// this package's, so build one here with the base every caller passes.
const API = createClient({ baseUrl: '/api' });

test('timelineUrlFor builds the endpoint URL with src', () => {
  const u = API.timelineUrlFor('/repo', undefined);
  expect(u).toContain('/api/timeline');
  expect(u).toContain('src=%2Frepo');
});

test('timelineUrlFor emits one repeated exclude param per path', () => {
  const u = API.timelineUrlFor('/repo', undefined, ['a.txt', 'secrets']);
  expect(u).toContain('exclude=a.txt');
  expect(u).toContain('exclude=secrets');
});

// The bundle caches per HEAD, so a Fresh scan is only fresh if it says so.
test('timelineUrlFor forwards noCache, and omits the param otherwise', () => {
  expect(API.timelineUrlFor('/repo', undefined, undefined, true)).toContain('no_cache=true');
  expect(API.timelineUrlFor('/repo', undefined, undefined, false)).not.toContain('no_cache');
  expect(API.timelineUrlFor('/repo', undefined)).not.toContain('no_cache');
});

test('fetchTimelineBundle puts noCache on the stream URL', () => {
  const { ctor, last } = makeES();
  void API.fetchTimelineBundle('/repo', undefined, undefined, {
    EventSourceImpl: ctor,
    noCache: true,
  });
  expect(last()!.url).toContain('no_cache=true');
});

const BUNDLE = {
  commits: [{ sha: 'a' }],
  unionManifest: { tree: { name: 'r' } },
  deltas: [],
  blobLines: {},
  blobSizes: {},
  note: null,
} as unknown as TimelineBundle;

describe('API.fetchTimelineBundle (SSE)', () => {
  it('reports progress events and resolves with the bundle on timeline-complete', async () => {
    const { ctor, last } = makeES();
    const progress: unknown[] = [];
    const promise = API.fetchTimelineBundle('/repo', undefined, (p) => progress.push(p), {
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
    const promise = API.fetchTimelineBundle('/repo', undefined, undefined, {
      EventSourceImpl: ctor,
    });
    last().emit('error', JSON.stringify({ error: 'boom' }));
    await expect(promise).rejects.toThrow(/boom/);
    expect(last().closed).toBe(true);
  });

  it('rejects on a transport-level error (bare error event, no data)', async () => {
    const { ctor, last } = makeES();
    const promise = API.fetchTimelineBundle('/repo', undefined, undefined, {
      EventSourceImpl: ctor,
    });
    last().emit('error');
    await expect(promise).rejects.toThrow(/connection failed/i);
  });

  it('skips straight to timeline-complete on a warm cache hit (no progress events)', async () => {
    const { ctor, last } = makeES();
    const progress: unknown[] = [];
    const promise = API.fetchTimelineBundle('/repo', undefined, (p) => progress.push(p), {
      EventSourceImpl: ctor,
    });
    last().emit('timeline-complete', JSON.stringify({ bundle: BUNDLE }));
    const bundle = await promise;
    expect(bundle).toEqual(BUNDLE);
    expect(progress).toEqual([]);
  });
});
