import { describe, it, expect } from 'vitest';
import { TEST_SOURCE } from '../_helpers/manifestFixtures';
import { createClient } from '../../src/client/index';

// The app used to hand these its own singleton; the client under test is
// this package's, so build one here with the base every caller passes.
const API = createClient({ baseUrl: '/api' });

describe('fileUrl', () => {
  it('names the repo and the path inside it, never an absolute one', () => {
    const url = new URL(API.fileUrl(TEST_SOURCE, 'src/a.ts'));
    expect(url.searchParams.get('src')).toBe(TEST_SOURCE.src);
    expect(url.searchParams.get('path')).toBe('src/a.ts');
  });

  it('carries the branch when the manifest was built with one', () => {
    const url = new URL(API.fileUrl({ src: 'https://host/o/r', branch: 'main' }, 'a.ts'));
    expect(url.searchParams.get('branch')).toBe('main');
    // Absent, not empty: the clone dir keys on the branch AS PASSED, and a
    // blank one is a different key than none.
    expect(new URL(API.fileUrl(TEST_SOURCE, 'a.ts')).searchParams.has('branch')).toBe(false);
  });

  it('omits the version param when none is given (unchanged URL)', () => {
    expect(API.fileUrl(TEST_SOURCE, 'a.ts')).not.toContain('v=');
  });

  it('adds a cache-busting mtime param carrying the given value', () => {
    const url = API.fileUrl(TEST_SOURCE, 'a.ts', '2026-07-19T12:00:00Z');
    expect(url).toContain('mtime=');
    expect(decodeURIComponent(url)).toContain('2026-07-19T12:00:00Z');
  });

  it('a blob sha replaces the mtime buster: content-addressed needs no cache key', () => {
    const url = API.fileUrl(TEST_SOURCE, 'a.ts', '2026-07-19T12:00:00Z', 'a'.repeat(40));
    expect(url).toContain(`sha=${'a'.repeat(40)}`);
    expect(url).not.toContain('mtime=');
  });
});
