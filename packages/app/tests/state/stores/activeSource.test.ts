import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  CURRENT_SOURCE_KEY,
  CURRENT_SOURCE,
  SOURCE_INFO,
  commitSource,
  clearSourceUrl,
  RECENTS,
} from '@/state/stores/source';
import { sourceKey } from '@/utils/sources';
import { setManifest } from '@/state/stores/manifest';
import { navigate, HREF, ROUTE_PATH, ROUTE_PARAMS } from '@/router/location';
import { ROUTES } from '@/router/paths';
import type { Manifest } from '@codecity/city';

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
    setManifest(null);
  });

  it('is empty when nothing is applied', () => {
    CURRENT_SOURCE.value = null;
    setManifest(null);
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

describe('clearSourceUrl', () => {
  afterEach(() => navigate(ROUTES.HOME, { replace: true }));

  it('drops the load AND what was being viewed of it, and goes home', () => {
    // A cancel with no city to fall back to leaves the switcher open over
    // nothing: a reload must not re-run the load that was just called off.
    navigate(
      '/city?src=https://github.com/o/r&branch=main&exclude=docs&mode=timeline&commit=abc&sel=file:a.ts'
    );
    clearSourceUrl();

    expect(HREF.value).toBe(ROUTES.HOME);
  });

  it('leaves anything it does not own alone', () => {
    navigate('/city?src=/proj&utm_source=x');
    clearSourceUrl();

    expect(ROUTE_PATH.value).toBe(ROUTES.HOME);
    expect(ROUTE_PARAMS.value.has('src')).toBe(false);
    expect(ROUTE_PARAMS.value.get('utm_source')).toBe('x');
  });
});

describe('commitSource', () => {
  afterEach(() => {
    CURRENT_SOURCE.value = null;
    RECENTS.value = [];
    navigate(ROUTES.HOME, { replace: true });
  });

  describe('the history entry it leaves', () => {
    const MANIFEST_FOR = { tree: { name: 'r' }, repo: { branch: 'main' } } as never;

    it('PUSHES when the project was opened from the switcher, so Back returns to it', () => {
      // The reported bug: opening a project replaced the home entry, which left
      // the browser's own Back with nothing to go back to.
      navigate(ROUTES.HOME, { replace: true });
      const push = vi.spyOn(history, 'pushState');
      commitSource('https://github.com/o/r', undefined, MANIFEST_FOR);

      expect(push).toHaveBeenCalledTimes(1);
      expect(ROUTE_PATH.value).toBe(ROUTES.CITY);
      push.mockRestore();
    });

    it('replaces when already on a city, since a re-scan is the same place', () => {
      navigate('/city?src=https://github.com/o/r', { replace: true });
      CURRENT_SOURCE.value = null;
      const push = vi.spyOn(history, 'pushState');
      commitSource('https://github.com/o/other', undefined, MANIFEST_FOR);

      expect(push).not.toHaveBeenCalled();
      expect(ROUTE_PARAMS.value.get('src')).toBe('https://github.com/o/other');
      push.mockRestore();
    });
  });

  it('resolves the branch once and gives the load ONE identity', () => {
    // Derived twice, the row resolved `main` while CURRENT_SOURCE kept the
    // branchless request, so no row ever matched the source that was loaded.
    commitSource('https://github.com/o/r', undefined, {
      tree: { name: 'r' },
      repo: { branch: 'main' },
    } as unknown as Manifest);
    expect(CURRENT_SOURCE.value).toEqual({ src: 'https://github.com/o/r', branch: 'main' });
    const recents = RECENTS.value;
    expect(recents[0].src).toBe('https://github.com/o/r');
    expect(recents[0].branch).toBe('main');
    expect(recents[0].branch, 'the row must match the source it just loaded').toBe(
      CURRENT_SOURCE.value!.branch
    );
  });

  it('keeps that one identity when Timeline recommits the same source', () => {
    commitSource('https://github.com/o/r', undefined, {
      tree: { name: 'r' },
      repo: { branch: 'main' },
    } as unknown as Manifest);
    // Timeline hands back the branch it was loaded with, and the union
    // manifest's detached-ref branch must not displace it.
    commitSource('https://github.com/o/r', CURRENT_SOURCE.value?.branch, {
      tree: { name: 'r' },
      repo: { branch: '@ 1a2b3c4d' },
    } as unknown as Manifest);

    expect(RECENTS.value.filter((r) => r.src === 'https://github.com/o/r')).toHaveLength(1);
    expect(RECENTS.value[0].branch).toBe('main');
  });

  it('records an explicitly-requested branch', () => {
    commitSource('https://github.com/o/r', 'dev', {
      tree: { name: 'r' },
      repo: { branch: 'dev' },
    } as unknown as Manifest);
    expect(CURRENT_SOURCE.value).toEqual({ src: 'https://github.com/o/r', branch: 'dev' });
    expect(RECENTS.value[0].branch).toBe('dev');
  });

  it('records a local source with no branch (branch is not part of its identity)', () => {
    // A local worktree scans whatever is checked out; storing that branch would
    // be a lie (it changes on disk), so the recent and CURRENT_SOURCE omit it.
    commitSource('/Users/me/worktrees/feat-x', undefined, {
      tree: { name: 'owner/codecity' },
      repo: { branch: 'feat/issue-77' },
    } as unknown as Manifest);
    expect(CURRENT_SOURCE.value).toEqual({ src: '/Users/me/worktrees/feat-x', branch: undefined });
    expect(RECENTS.value[0].branch).toBeUndefined();
  });

  it('dedupes a local path across checkouts into one recent', () => {
    // Opening the same local path at two different checkouts must not spawn a
    // second row: both commits store branch: undefined, so they dedupe by src.
    commitSource('/proj', undefined, {
      tree: { name: 'proj' },
      repo: { branch: 'main' },
    } as unknown as Manifest);
    commitSource('/proj', undefined, {
      tree: { name: 'proj' },
      repo: { branch: 'feat/x' },
    } as unknown as Manifest);
    expect(RECENTS.value).toHaveLength(1);
    expect(RECENTS.value[0].branch).toBeUndefined();
  });

  it('drops the branch from CURRENT_SOURCE + the URL for a local source', () => {
    // Even if a stale branch is passed in (old deep-link, recents onOpen), a
    // local source never carries it: CURRENT_SOURCE and the page URL stay clean.
    commitSource('/Users/me/proj', 'stale-branch', {
      tree: { name: 'proj' },
      repo: { branch: 'main' },
    } as unknown as Manifest);
    expect(CURRENT_SOURCE.value).toEqual({ src: '/Users/me/proj', branch: undefined });
    const u = new URL(window.location.href);
    expect(u.searchParams.has('branch')).toBe(false);
  });
});
