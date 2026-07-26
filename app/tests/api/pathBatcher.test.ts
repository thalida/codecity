// pathBatcher.test.ts — the coalescing core shared by the media and fingerprint
// batchers. Chunking at the server's published cap is the case worth pinning:
// the server silently truncates anything past it, so an over-large chunk loses
// its tail with no error anywhere.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createPathBatcher } from '@/api/pathBatcher';
import { serverConfigNow } from '@/api/config';

vi.mock('@/api/config', () => ({
  serverConfigNow: vi.fn(() => ({ allowLocalRepos: false, maxBatchPaths: 3 })),
}));

interface Entry {
  v: string;
}

function mockFetch(handler: (paths: string[]) => unknown, ok = true) {
  const bodies: { url: string; paths: string[]; raw: Record<string, unknown> }[] = [];
  const fn = vi.fn(async (url: string, opts: { body: string }) => {
    const raw = JSON.parse(opts.body) as Record<string, unknown>;
    bodies.push({ url, paths: raw.paths as string[], raw });
    return { ok, json: async () => handler(raw.paths as string[]) } as Response;
  });
  vi.stubGlobal('fetch', fn);
  return bodies;
}

const echo = (paths: string[]) => Object.fromEntries(paths.map((p) => [p, { v: `${p}!` }]));

function makeBatcher(over: Partial<Parameters<typeof createPathBatcher<string, Entry>>[0]> = {}) {
  return createPathBatcher<string, Entry>({
    endpoint: '/api/things',
    decode: (e) => e.v,
    ...over,
  });
}

describe('createPathBatcher', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('coalesces requests inside the window into one POST', async () => {
    const bodies = mockFetch(echo);
    const batcher = makeBatcher();
    const all = Promise.all([batcher.request('a'), batcher.request('b')]);
    await vi.runAllTimersAsync();

    expect(bodies).toHaveLength(1);
    expect(bodies[0].url).toBe('/api/things');
    expect(await all).toEqual(['a!', 'b!']);
  });

  it('splits into chunks no larger than the cap the server published', async () => {
    const bodies = mockFetch(echo);
    const batcher = makeBatcher();
    const paths = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const all = Promise.all(paths.map((p) => batcher.request(p)));
    await vi.runAllTimersAsync();

    // cap is 3, so 7 paths -> 3 + 3 + 1, and every path still resolves.
    expect(bodies.map((b) => b.paths.length)).toEqual([3, 3, 1]);
    expect(bodies.flatMap((b) => b.paths)).toEqual(paths);
    expect(await all).toEqual(paths.map((p) => `${p}!`));
  });

  it('re-reads the cap per flush, so a config that arrives late is honoured', async () => {
    const bodies = mockFetch(echo);
    vi.mocked(serverConfigNow).mockReturnValueOnce({ allowLocalRepos: false, maxBatchPaths: 2 });
    const batcher = makeBatcher();
    const all = Promise.all(['a', 'b', 'c'].map((p) => batcher.request(p)));
    await vi.runAllTimersAsync();

    expect(bodies.map((b) => b.paths.length)).toEqual([2, 1]);
    expect(await all).toEqual(['a!', 'b!', 'c!']);
  });

  it('merges bodyFor fields into the request alongside paths', async () => {
    const bodies = mockFetch(echo);
    const batcher = makeBatcher({ bodyFor: (paths) => ({ shas: { [paths[0]]: 'deadbeef' } }) });
    void batcher.request('a');
    await vi.runAllTimersAsync();

    expect(bodies[0].raw.shas).toEqual({ a: 'deadbeef' });
  });

  it('gives every waiter on one path the same value, with a single queue entry', async () => {
    const bodies = mockFetch(echo);
    const batcher = makeBatcher();
    const all = Promise.all([batcher.request('a'), batcher.request('a')]);
    await vi.runAllTimersAsync();

    expect(bodies[0].paths).toEqual(['a']);
    expect(await all).toEqual(['a!', 'a!']);
  });

  it('runs onSettled once per path so per-request state can be released', async () => {
    mockFetch(echo);
    const settled: string[] = [];
    const batcher = makeBatcher({ onSettled: (p) => settled.push(p) });
    void Promise.all([batcher.request('a'), batcher.request('b')]);
    await vi.runAllTimersAsync();

    expect(settled).toEqual(['a', 'b']);
  });

  it('resolves null for a path the server omits', async () => {
    mockFetch(() => ({}));
    const batcher = makeBatcher();
    const value = batcher.request('a');
    await vi.runAllTimersAsync();

    expect(await value).toBeNull();
  });

  it('resolves null for every path when the request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      })
    );
    const batcher = makeBatcher();
    const all = Promise.all([batcher.request('a'), batcher.request('b')]);
    await vi.runAllTimersAsync();

    expect(await all).toEqual([null, null]);
  });

  it('starts a fresh batch for requests arriving after a flush', async () => {
    const bodies = mockFetch(echo);
    const batcher = makeBatcher();
    void batcher.request('a');
    await vi.runAllTimersAsync();
    void batcher.request('b');
    await vi.runAllTimersAsync();

    expect(bodies.map((b) => b.paths)).toEqual([['a'], ['b']]);
  });
});
