import { describe, it, expect } from 'vitest';
import { fileUrl } from '@/api/file';

describe('fileUrl', () => {
  it('omits the version param when none is given (unchanged URL)', () => {
    expect(fileUrl('/tmp/project/a.ts')).not.toContain('v=');
  });

  it('adds a cache-busting mtime param carrying the given value', () => {
    const url = fileUrl('/tmp/project/a.ts', '2026-07-19T12:00:00Z');
    expect(url).toContain('mtime=');
    expect(decodeURIComponent(url)).toContain('2026-07-19T12:00:00Z');
  });

  it('a blob sha replaces the mtime buster: content-addressed needs no cache key', () => {
    const url = fileUrl('/tmp/project/a.ts', '2026-07-19T12:00:00Z', 'a'.repeat(40));
    expect(url).toContain(`sha=${'a'.repeat(40)}`);
    expect(url).not.toContain('mtime=');
  });
});
