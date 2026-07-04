import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchBranches } from '@/api/branches';

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

  it('rejects with the server error on non-2xx', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ detail: 'repository not found' }), { status: 404 })
      )
    );
    await expect(fetchBranches('https://github.com/o/nope')).rejects.toThrow(/not found/i);
  });
});
