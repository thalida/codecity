import { test, expect, describe, it } from 'vitest';
import { timelineUrlFor, fetchTimelineBundle } from '@/api/timeline';
import type { TimelineBundle } from '@/types';
import { makeES } from '../_helpers/eventSource';

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
