import { describe, it, expect, afterEach } from 'vitest';
import {
  sourceKey,
  CURRENT_SOURCE_KEY,
  CURRENT_SOURCE,
  SOURCE_INFO,
  setCurrentSource,
  listRecents,
  RECENTS,
} from '@/state/stores/source';
import { setManifest } from '@/state/stores/manifest';
import { EMPTY_MANIFEST } from '@/constants/manifest';
import type { Manifest } from '@/types';

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

describe('SOURCE_INFO (derived from MANIFEST + CURRENT_SOURCE)', () => {
  afterEach(() => {
    CURRENT_SOURCE.value = null;
    setManifest(EMPTY_MANIFEST);
  });

  it('is empty when nothing is applied', () => {
    CURRENT_SOURCE.value = null;
    setManifest(EMPTY_MANIFEST);
    expect(SOURCE_INFO.value).toEqual({
      label: '',
      branch: undefined,
      sourceUrl: undefined,
      src: undefined,
    });
  });

  it('exposes the git URL as sourceUrl for a git source', () => {
    CURRENT_SOURCE.value = { src: 'https://github.com/o/r', branch: 'main' };
    setManifest({ tree: { name: 'r' }, repo: { branch: 'main' } } as unknown as Manifest);
    expect(SOURCE_INFO.value.sourceUrl).toBe('https://github.com/o/r');
    expect(SOURCE_INFO.value.branch).toBe('main');
    expect(SOURCE_INFO.value.label).toBe('r');
  });

  it('has no sourceUrl for a local path source', () => {
    CURRENT_SOURCE.value = { src: '/Users/me/proj' };
    setManifest({ tree: { name: 'proj' }, repo: {} } as unknown as Manifest);
    expect(SOURCE_INFO.value.sourceUrl).toBeUndefined();
  });
});

describe('setCurrentSource', () => {
  afterEach(() => {
    CURRENT_SOURCE.value = null;
    RECENTS.value = [];
    history.replaceState(null, '', '/');
  });

  it('sets CURRENT_SOURCE and records a recent with the resolved branch', () => {
    setCurrentSource('https://github.com/o/r', undefined, {
      tree: { name: 'r' },
      repo: { branch: 'main' },
    } as unknown as Manifest);
    expect(CURRENT_SOURCE.value).toEqual({ src: 'https://github.com/o/r', branch: undefined });
    const recents = listRecents();
    expect(recents[0].src).toBe('https://github.com/o/r');
    expect(recents[0].branch).toBe('main');
  });

  it('records an explicitly-requested branch', () => {
    setCurrentSource('https://github.com/o/r', 'dev', {
      tree: { name: 'r' },
      repo: { branch: 'dev' },
    } as unknown as Manifest);
    expect(CURRENT_SOURCE.value).toEqual({ src: 'https://github.com/o/r', branch: 'dev' });
    expect(listRecents()[0].branch).toBe('dev');
  });

  it('records a local source with its working-tree checkout branch', () => {
    // A local worktree ignores any requested branch and reports its checkout.
    setCurrentSource('/Users/me/worktrees/feat-x', undefined, {
      tree: { name: 'owner/codecity' },
      repo: { branch: 'feat/issue-77' },
    } as unknown as Manifest);
    expect(listRecents()[0].branch).toBe('feat/issue-77');
  });
});
