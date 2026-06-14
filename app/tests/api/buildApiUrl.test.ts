import { describe, it, expect } from 'vitest';
import { buildApiUrl, manifestUrlFor, signatureUrlFor } from '@/api/manifest';

describe('buildApiUrl', () => {
  it('forwards src param when present', () => {
    const u = buildApiUrl('/api/manifest', '?src=/foo/bar', 'http://127.0.0.1:8765');
    expect(u).toContain('src=%2Ffoo%2Fbar');
  });

  it('forwards src and branch together', () => {
    const u = buildApiUrl(
      '/api/manifest',
      '?src=https%3A%2F%2Fgithub.com%2Fo%2Fr&branch=main',
      'http://127.0.0.1:8765'
    );
    expect(u).toContain('src=https');
    expect(u).toContain('branch=main');
  });

  it('returns endpoint with no source params when src absent', () => {
    const u = buildApiUrl('/api/manifest', '', 'http://127.0.0.1:8765');
    expect(u).not.toContain('src=');
    expect(u).not.toContain('branch=');
  });

  it('appends no_cache=true when noCache is true', () => {
    const url = buildApiUrl('/api/manifest', '?src=foo', 'http://localhost', {
      noCache: true,
    });
    expect(url).toContain('no_cache=true');
  });

  it('omits no_cache when noCache is false or undefined', () => {
    const url = buildApiUrl('/api/manifest', '?src=foo', 'http://localhost');
    expect(url).not.toContain('no_cache');
    const url2 = buildApiUrl('/api/manifest', '?src=foo', 'http://localhost', {
      noCache: false,
    });
    expect(url2).not.toContain('no_cache');
  });
});

// The live-update poll targets the committed CURRENT_SOURCE via these builders,
// never the page URL — a poll reading window.location mid-switch was the cause
// of the wrong-world render. These guard that the builders address the explicit
// source they're handed and ignore the page URL entirely.
describe('explicit-source URL builders', () => {
  it('manifestUrlFor builds from the given src/branch, ignoring the page URL', () => {
    history.replaceState({}, '', '/?src=PAGE_SRC&branch=PAGE_BRANCH');
    const u = manifestUrlFor({ src: 'https://github.com/o/r', branch: 'feat' });
    expect(u).toContain('src=https%3A%2F%2Fgithub.com%2Fo%2Fr');
    expect(u).toContain('branch=feat');
    expect(u).not.toContain('PAGE_SRC');
    expect(u).not.toContain('PAGE_BRANCH');
  });

  it('manifestUrlFor omits branch when absent and forwards noCache', () => {
    const u = manifestUrlFor({ src: '/local/path', noCache: true });
    expect(u).toContain('src=%2Flocal%2Fpath');
    expect(u).not.toContain('branch=');
    expect(u).toContain('no_cache=true');
  });

  it('signatureUrlFor builds from the given src/branch, ignoring the page URL', () => {
    history.replaceState({}, '', '/?src=PAGE_SRC&branch=PAGE_BRANCH');
    const u = signatureUrlFor('https://github.com/o/r', 'feat');
    expect(u).toContain('/api/manifest/signature');
    expect(u).toContain('src=https%3A%2F%2Fgithub.com%2Fo%2Fr');
    expect(u).toContain('branch=feat');
    expect(u).not.toContain('PAGE_SRC');
  });
});
