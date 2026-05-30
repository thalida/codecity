import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fetchServerConfig, getServerConfig, _resetServerConfigForTests } from '@/utils/serverConfig.js';

describe('fetchServerConfig', () => {
  beforeEach(() => {
    _resetServerConfigForTests();
    vi.restoreAllMocks();
  });

  it('returns the parsed config on a successful 200', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ allowLocalRepos: true }), { status: 200 })
    );
    const cfg = await fetchServerConfig();
    expect(cfg).toEqual({ allowLocalRepos: true });
  });

  it('coerces a missing allowLocalRepos to false', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({}), { status: 200 })
    );
    const cfg = await fetchServerConfig();
    expect(cfg).toEqual({ allowLocalRepos: false });
  });

  it('fails closed on a non-200 response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('oops', { status: 500 })
    );
    const cfg = await fetchServerConfig();
    expect(cfg).toEqual({ allowLocalRepos: false });
  });

  it('fails closed on a network error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('offline'));
    const cfg = await fetchServerConfig();
    expect(cfg).toEqual({ allowLocalRepos: false });
  });

  it('fails closed on malformed JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('not-json', { status: 200 })
    );
    const cfg = await fetchServerConfig();
    expect(cfg).toEqual({ allowLocalRepos: false });
  });
});

describe('getServerConfig', () => {
  beforeEach(() => {
    _resetServerConfigForTests();
    vi.restoreAllMocks();
  });

  it('memoizes the first successful fetch', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ allowLocalRepos: true }), { status: 200 })
      );
    await getServerConfig();
    await getServerConfig();
    await getServerConfig();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
