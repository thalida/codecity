import { describe, it, expect } from 'vitest';
import { buildApiUrl } from '@/api/urls.js';

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
