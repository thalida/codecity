import { describe, it, expect, vi, afterEach } from 'vitest';
import { API } from '@/apiClient';

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
    const r = await API.fetchBranches('https://github.com/o/r');
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
    await expect(API.fetchBranches('https://github.com/o/nope')).rejects.toThrow(
      /repository not found/i
    );
  });

  it('falls back to FastAPI { detail } when there is no { error }', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ detail: 'nope' }), { status: 400 }))
    );
    await expect(API.fetchBranches('https://github.com/o/x')).rejects.toThrow(/nope/);
  });
});
