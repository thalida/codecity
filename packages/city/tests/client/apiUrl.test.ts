import { describe, it, expect } from 'vitest';
import { createClient } from '../../src/client/index';

// The app used to hand these its own singleton; the client under test is
// this package's, so build one here with the base every caller passes.
const API = createClient({ baseUrl: '/api' });

describe('apiUrl', () => {
  it('builds an absolute /api/<path> URL on the current origin', () => {
    const u = API.apiUrl('branches');
    expect(u).toContain('/api/branches');
    expect(u.startsWith('http')).toBe(true);
  });

  it('sets provided query params and skips undefined ones', () => {
    const u = API.apiUrl('branches', { src: '/foo/bar', branch: undefined });
    expect(u).toContain('src=%2Ffoo%2Fbar');
    expect(u).not.toContain('branch=');
  });

  it('emits repeated params for array values', () => {
    const url = API.apiUrl('manifest', { src: 'x', exclude: ['a', 'b'] });
    const params = new URL(url).searchParams;
    expect(params.getAll('exclude')).toEqual(['a', 'b']);
    expect(params.get('src')).toBe('x');
  });

  it('skips empty arrays and undefined', () => {
    const url = API.apiUrl('manifest', { src: 'x', exclude: [], branch: undefined });
    const params = new URL(url).searchParams;
    expect(params.getAll('exclude')).toEqual([]);
    expect(params.has('branch')).toBe(false);
  });
});

// The live-update poll targets the committed CURRENT_SOURCE via these builders,
// never the page URL — a poll reading window.location mid-switch was the cause
// of the wrong-world render. These guard that the builders address the explicit
// source they're handed and ignore the page URL entirely.
describe('explicit-source URL builders', () => {
  it('manifestUrlFor builds from the given src/branch, ignoring the page URL', () => {
    history.replaceState({}, '', '/?src=PAGE_SRC&branch=PAGE_BRANCH');
    const u = API.manifestUrlFor({ src: 'https://github.com/o/r', branch: 'feat' });
    expect(u).toContain('/api/manifest');
    expect(u).toContain('src=https%3A%2F%2Fgithub.com%2Fo%2Fr');
    expect(u).toContain('branch=feat');
    expect(u).not.toContain('PAGE_SRC');
    expect(u).not.toContain('PAGE_BRANCH');
  });

  it('manifestUrlFor omits branch when absent and forwards noCache', () => {
    const u = API.manifestUrlFor({ src: '/local/path', noCache: true });
    expect(u).toContain('src=%2Flocal%2Fpath');
    expect(u).not.toContain('branch=');
    expect(u).toContain('no_cache=true');
  });

  it('manifestUrlFor omits no_cache when noCache is false/undefined', () => {
    expect(API.manifestUrlFor({ src: 'foo' })).not.toContain('no_cache');
    expect(API.manifestUrlFor({ src: 'foo', noCache: false })).not.toContain('no_cache');
  });

  it('signatureUrlFor builds from the given src/branch, ignoring the page URL', () => {
    history.replaceState({}, '', '/?src=PAGE_SRC&branch=PAGE_BRANCH');
    const u = API.signatureUrlFor('https://github.com/o/r', 'feat');
    expect(u).toContain('/api/manifest/signature');
    expect(u).toContain('src=https%3A%2F%2Fgithub.com%2Fo%2Fr');
    expect(u).toContain('branch=feat');
    expect(u).not.toContain('PAGE_SRC');
  });

  it('includes exclude params on the manifest url', () => {
    const params = new URL(API.manifestUrlFor({ src: 's', exclude: ['sub', 'a.md'] })).searchParams;
    expect(params.getAll('exclude')).toEqual(['sub', 'a.md']);
  });

  it('includes exclude params on the signature url', () => {
    const params = new URL(API.signatureUrlFor('s', undefined, ['sub'])).searchParams;
    expect(params.getAll('exclude')).toEqual(['sub']);
  });
});
