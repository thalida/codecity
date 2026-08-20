import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchBranches, _resetBranchCacheForTests } from '@/api/branches';

// The memo is module state: without this, one test's answer is the next's.
beforeEach(() => _resetBranchCacheForTests());
afterEach(() => vi.restoreAllMocks());

describe('fetchBranches', () => {
  it('returns branches + default on ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ branches: ['main', 'dev'], default: 'main' }), {
            status: 200,
          })
      )
    );
    const r = await fetchBranches('https://github.com/o/r');
    expect(r.branches).toEqual(['main', 'dev']);
    expect(r.default).toBe('main');
  });

  it('rejects with the server error message (the API { error } envelope) on non-2xx', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ error: 'repository not found at https://github.com/o/nope' }),
            {
              status: 404,
            }
          )
      )
    );
    await expect(fetchBranches('https://github.com/o/nope')).rejects.toThrow(
      /repository not found/i
    );
  });

  it('falls back to FastAPI { detail } when there is no { error }', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ detail: 'nope' }), { status: 400 }))
    );
    await expect(fetchBranches('https://github.com/o/x')).rejects.toThrow(/nope/);
  });

  it('asks the server once per URL', async () => {
    // Each miss is the server running git ls-remote against the remote, and the
    // form re-resolves whenever the field is edited back to a URL it has seen.
    const f = vi.fn(
      async () =>
        new Response(JSON.stringify({ branches: ['main'], default: 'main' }), { status: 200 })
    );
    vi.stubGlobal('fetch', f);

    const first = await fetchBranches('https://github.com/o/r');
    const second = await fetchBranches('https://github.com/o/r');

    expect(f).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
    // A different repo is a different question.
    await fetchBranches('https://github.com/o/other');
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('does not keep a failure', async () => {
    // A cached refusal would outlive the outage behind it, leaving the form
    // insisting a reachable repo is unreachable until reload.
    const f = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'down' }), { status: 502 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ branches: ['main'], default: 'main' }), { status: 200 })
      );
    vi.stubGlobal('fetch', f);

    await expect(fetchBranches('https://github.com/o/flaky')).rejects.toThrow(/down/);
    const retried = await fetchBranches('https://github.com/o/flaky');

    expect(retried.branches).toEqual(['main']);
    expect(f).toHaveBeenCalledTimes(2);
  });
});
