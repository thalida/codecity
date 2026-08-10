import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fetchServerConfig, getServerConfig, _resetServerConfigForTests } from '@/api/config';
import { DEFAULT_SERVER_CONFIG } from '@/state/stores/serverConfig';

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
    expect(cfg).toEqual({ ...DEFAULT_SERVER_CONFIG, allowLocalRepos: true });
  });

  it('coerces a missing allowLocalRepos to false', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({}), { status: 200 })
    );
    const cfg = await fetchServerConfig();
    expect(cfg).toEqual(DEFAULT_SERVER_CONFIG);
  });

  it('fails closed on a non-200 response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('oops', { status: 500 }));
    const cfg = await fetchServerConfig();
    expect(cfg).toEqual(DEFAULT_SERVER_CONFIG);
  });

  it('fails closed on a network error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('offline'));
    const cfg = await fetchServerConfig();
    expect(cfg).toEqual(DEFAULT_SERVER_CONFIG);
  });

  it('fails closed on malformed JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('not-json', { status: 200 }));
    const cfg = await fetchServerConfig();
    expect(cfg).toEqual(DEFAULT_SERVER_CONFIG);
  });

  // Regression: a hand-listed parser silently drops any field the server adds,
  // leaving the client on its stale default.
  it('carries through a field the hardcoded parser would have dropped', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ allowLocalRepos: false, maxBatchPaths: 64 }), { status: 200 })
    );
    const cfg = await fetchServerConfig();
    expect(cfg.maxBatchPaths).toBe(64);
  });

  it('keeps the safe default when the server sends a nonsense batch cap', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ allowLocalRepos: false, maxBatchPaths: 0 }), { status: 200 })
    );
    const cfg = await fetchServerConfig();
    expect(cfg.maxBatchPaths).toBe(DEFAULT_SERVER_CONFIG.maxBatchPaths);
  });

  it('carries the version through from the server', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ allowLocalRepos: false, version: '1.3.0' }), { status: 200 })
    );
    const cfg = await fetchServerConfig();
    expect(cfg.version).toBe('1.3.0');
  });

  it('carries hosted through from the server', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ allowLocalRepos: false, hosted: true }), { status: 200 })
    );
    const cfg = await fetchServerConfig();
    expect(cfg.hosted).toBe(true);
  });

  // Fails closed the way allowLocalRepos does: telling a local user to go run
  // codecity locally is a worse error than the reverse.
  it('coerces a missing hosted to false', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ allowLocalRepos: false }), { status: 200 })
    );
    const cfg = await fetchServerConfig();
    expect(cfg.hosted).toBe(false);
  });

  it('keeps the unknown-version default when the server omits it', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ allowLocalRepos: false }), { status: 200 })
    );
    const cfg = await fetchServerConfig();
    expect(cfg.version).toBe('0.0.0+unknown');
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
      .mockResolvedValue(new Response(JSON.stringify({ allowLocalRepos: true }), { status: 200 }));
    await getServerConfig();
    await getServerConfig();
    await getServerConfig();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
