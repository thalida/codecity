import { describe, it, expect, beforeEach } from 'vitest';
import { buildApiUrl } from '@/url.js';
import { SCAN_FILTERS } from '@/config/scan.js';

describe('buildApiUrl', () => {
  beforeEach(() => {
    SCAN_FILTERS.setKey('SHOW_ALL_FILES', false);
  });

  it('forwards path query param', () => {
    const url = buildApiUrl('/api/manifest', '?path=/tmp/foo', 'http://x.test');
    expect(url).toBe('http://x.test/api/manifest?path=%2Ftmp%2Ffoo');
  });

  it('forwards clone + branch query params', () => {
    const url = buildApiUrl(
      '/api/manifest/signature',
      '?clone=https://github.com/a/b&branch=main',
      'http://x.test'
    );
    expect(url).toContain('clone=https%3A%2F%2Fgithub.com%2Fa%2Fb');
    expect(url).toContain('branch=main');
  });

  it('omits include_all when SHOW_ALL_FILES is off (default)', () => {
    const url = buildApiUrl('/api/manifest', '?path=/tmp', 'http://x.test');
    expect(url).not.toContain('include_all');
  });

  it('appends include_all=true when SHOW_ALL_FILES is on', () => {
    SCAN_FILTERS.setKey('SHOW_ALL_FILES', true);
    const url = buildApiUrl('/api/manifest', '?path=/tmp', 'http://x.test');
    expect(url).toContain('include_all=true');
  });

  it('drops unrelated query params from the page URL', () => {
    const url = buildApiUrl(
      '/api/manifest',
      '?path=/tmp&unrelated=1',
      'http://x.test'
    );
    expect(url).not.toContain('unrelated');
  });
});
