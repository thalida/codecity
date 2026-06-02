import { describe, it, expect, afterEach } from 'vitest';
import { sourceKey, CURRENT_SOURCE_KEY, CURRENT_SOURCE } from '@/state/stores/source';

describe('sourceKey', () => {
  it('is deterministic for the same (src, branch)', () => {
    expect(sourceKey('/foo', 'main')).toBe(sourceKey('/foo', 'main'));
  });

  it('distinguishes branches', () => {
    expect(sourceKey('/foo', 'main')).not.toBe(sourceKey('/foo', 'develop'));
  });

  it('distinguishes (src, undefined) from (src, "main")', () => {
    expect(sourceKey('/foo')).not.toBe(sourceKey('/foo', 'main'));
  });

  it('produces a short alphanumeric string', () => {
    const k = sourceKey('/Users/example/repos/codecity');
    expect(k).toMatch(/^[a-z0-9]{1,10}$/);
  });
});

describe('CURRENT_SOURCE → CURRENT_SOURCE_KEY (derived)', () => {
  afterEach(() => {
    CURRENT_SOURCE.value = null;
    history.replaceState(null, '', '/');
  });

  it('is null when no source is applied', () => {
    CURRENT_SOURCE.value = null;
    expect(CURRENT_SOURCE_KEY.value).toBeNull();
  });

  it('derives the hash from the applied source', () => {
    CURRENT_SOURCE.value = { src: '/foo', branch: 'main' };
    expect(CURRENT_SOURCE_KEY.value).toBe(sourceKey('/foo', 'main'));
  });

  it('syncs the applied source into the page URL', () => {
    CURRENT_SOURCE.value = { src: 'https://github.com/o/r', branch: 'dev' };
    const u = new URL(window.location.href);
    expect(u.searchParams.get('src')).toBe('https://github.com/o/r');
    expect(u.searchParams.get('branch')).toBe('dev');
  });

  it('omits branch in the URL when none is applied', () => {
    CURRENT_SOURCE.value = { src: '/foo' };
    const u = new URL(window.location.href);
    expect(u.searchParams.get('src')).toBe('/foo');
    expect(u.searchParams.has('branch')).toBe(false);
  });
});
