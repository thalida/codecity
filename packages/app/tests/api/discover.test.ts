import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fetchDiscover, getDiscover, _resetDiscoverForTests } from '@/api/discover';

const ENTRY = { url: 'https://github.com/preactjs/preact', label: 'preact' };

function respond(body: unknown, status = 200) {
  return vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
}

describe('fetchDiscover', () => {
  beforeEach(() => {
    _resetDiscoverForTests();
    vi.restoreAllMocks();
  });

  it('returns the curated list on a successful 200', async () => {
    respond({ repos: [ENTRY] });
    expect(await fetchDiscover()).toEqual([ENTRY]);
  });

  it('returns empty when the server has Discover switched off', async () => {
    respond({ repos: [] });
    expect(await fetchDiscover()).toEqual([]);
  });

  // Every one of these hides the tab rather than surfacing a broken row, so
  // "the server said no" and "the request fell over" land the same way.
  it('returns empty on a non-200 response', async () => {
    respond('nope', 500);
    expect(await fetchDiscover()).toEqual([]);
  });

  it('returns empty on a network error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('offline'));
    expect(await fetchDiscover()).toEqual([]);
  });

  it('returns empty on malformed JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('not-json', { status: 200 }));
    expect(await fetchDiscover()).toEqual([]);
  });

  it('returns empty when repos is missing or not an array', async () => {
    respond({});
    expect(await fetchDiscover()).toEqual([]);
    _resetDiscoverForTests();
    respond({ repos: 'preact' });
    expect(await fetchDiscover()).toEqual([]);
  });

  it('drops rows with nothing to open or nothing to click', async () => {
    respond({
      repos: [ENTRY, { url: '', label: 'x' }, { url: 'https://e.com/a', label: '' }],
    });
    expect(await fetchDiscover()).toEqual([ENTRY]);
  });
});

describe('getDiscover', () => {
  beforeEach(() => {
    _resetDiscoverForTests();
    vi.restoreAllMocks();
  });

  it('memoizes the first fetch', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ repos: [ENTRY] }), { status: 200 }));
    await getDiscover();
    await getDiscover();
    await getDiscover();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
