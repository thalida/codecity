import { describe, it, expect } from 'vitest';
import { fileUrl } from '@/api/file';

describe('fileUrl', () => {
  it('omits the version param when none is given (unchanged URL)', () => {
    expect(fileUrl('/tmp/project/a.ts')).not.toContain('v=');
  });

  it('adds a cache-busting v param carrying the given version', () => {
    const url = fileUrl('/tmp/project/a.ts', '2026-07-19T12:00:00Z');
    expect(url).toContain('v=');
    expect(decodeURIComponent(url)).toContain('2026-07-19T12:00:00Z');
  });
});
