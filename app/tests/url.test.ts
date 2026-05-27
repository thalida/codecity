import { describe, it, expect, beforeEach } from 'vitest';
import { buildApiUrl } from '@/utils/url.js';
import { SCAN_FILTERS } from '@/config/prefs/scanFilters.js';

describe('buildApiUrl', () => {
  beforeEach(() => {
    SCAN_FILTERS.set({ NO_CACHE: false });
  });

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

  it('appends no_cache=true when NO_CACHE is on', () => {
    SCAN_FILTERS.setKey('NO_CACHE', true);
    const u = buildApiUrl('/api/manifest', '?src=/foo', 'http://127.0.0.1:8765');
    expect(u).toContain('no_cache=true');
  });
});
