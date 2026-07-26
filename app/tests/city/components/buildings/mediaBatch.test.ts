// mediaBatch.test.ts — the image-fetch coalescer: many concurrent requests
// collapse into one POST /api/images, each resolving to its own Blob (or null
// when the server omits it / the network fails).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchMediaBlob } from '@/city/components/buildings/mediaBatch';

interface FetchCall {
  url: string;
  paths: string[];
}

function mockFetch(handler: (paths: string[]) => unknown) {
  const calls: FetchCall[] = [];
  const fn = vi.fn(async (url: string, opts: { body: string }) => {
    const paths = JSON.parse(opts.body).paths as string[];
    calls.push({ url, paths });
    return { ok: true, json: async () => handler(paths) } as Response;
  });
  vi.stubGlobal('fetch', fn);
  return { fn, calls };
}

describe('fetchMediaBlob', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('coalesces concurrent requests into one POST and resolves each blob', async () => {
    const { fn, calls } = mockFetch((paths) =>
      Object.fromEntries(paths.map((p) => [p, { mime: 'image/png', b64: btoa(p) }]))
    );

    const a = fetchMediaBlob('/x/a.png');
    const b = fetchMediaBlob('/x/b.png');
    await vi.advanceTimersByTimeAsync(20);
    const [ba, bb] = await Promise.all([a, b]);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(calls[0].url).toBe('/api/images');
    expect(calls[0].paths).toEqual(['/x/a.png', '/x/b.png']);
    expect(ba).toBeInstanceOf(Blob);
    expect(ba!.type).toBe('image/png');
    expect(ba!.size).toBe('/x/a.png'.length); // atob(btoa(path)) round-trips
    expect(bb).toBeInstanceOf(Blob);
  });

  it('dedups identical paths into a single queue entry', async () => {
    const { calls } = mockFetch((paths) =>
      Object.fromEntries(paths.map((p) => [p, { mime: 'image/png', b64: btoa(p) }]))
    );
    const [a, b] = [fetchMediaBlob('/x/dup.png'), fetchMediaBlob('/x/dup.png')];
    await vi.advanceTimersByTimeAsync(20);
    await Promise.all([a, b]);
    expect(calls[0].paths).toEqual(['/x/dup.png']); // requested once, both resolve
  });

  it('resolves null for a path the server omits', async () => {
    mockFetch(() => ({})); // empty map
    const p = fetchMediaBlob('/x/missing.png');
    await vi.advanceTimersByTimeAsync(20);
    expect(await p).toBeNull();
  });

  it('resolves null on network failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      })
    );
    const p = fetchMediaBlob('/x/c.png');
    await vi.advanceTimersByTimeAsync(20);
    expect(await p).toBeNull();
  });
});
