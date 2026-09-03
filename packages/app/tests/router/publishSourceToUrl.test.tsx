// The open project, reflected into the URL. A reaction, so it is mounted: a
// module-level effect that navigates fires on any import that reaches it.

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import type { Manifest } from '@codecity/city';
import { render } from 'preact';

import { usePublishSourceToUrl } from '@/router/cityUrl';
import { CURRENT_SOURCE, commitSource } from '@/state/source';
import { RECENTS } from '@/state/recents';
import { navigate, ROUTES, ROUTE_PATH, ROUTE_PARAMS } from '@/router/location';
import { drainAsync } from '../_helpers/preact';

function Reflector() {
  usePublishSourceToUrl();
  return null;
}

let host: HTMLDivElement;
beforeEach(async () => {
  host = document.createElement('div');
  document.body.appendChild(host);
  render(<Reflector />, host);
  // Preact flushes effects on a frame, which jsdom runs on a ~16ms timer.
  await drainAsync();
});
afterEach(() => {
  render(null, host);
  host.remove();
});

describe('the applied source in the page URL', () => {
  afterEach(() => {
    CURRENT_SOURCE.value = null;
    navigate(ROUTES.HOME, { replace: true });
  });

  it('carries the src and its branch', async () => {
    CURRENT_SOURCE.value = { src: 'https://github.com/o/r', branch: 'dev' };
    await drainAsync();
    expect(ROUTE_PARAMS.value.get('src')).toBe('https://github.com/o/r');
    expect(ROUTE_PARAMS.value.get('branch')).toBe('dev');
  });

  it('omits the branch when none is applied', async () => {
    CURRENT_SOURCE.value = { src: '/foo' };
    await drainAsync();
    expect(ROUTE_PARAMS.value.get('src')).toBe('/foo');
    expect(ROUTE_PARAMS.value.has('branch')).toBe(false);
  });
});

describe('the history entry a commit leaves', () => {
  afterEach(() => {
    CURRENT_SOURCE.value = null;
    RECENTS.value = [];
    navigate(ROUTES.HOME, { replace: true });
  });

  describe('the history entry it leaves', () => {
    const MANIFEST_FOR = { tree: { name: 'r' }, repo: { branch: 'main' } } as never;

    it('PUSHES when the project was opened from the switcher, so Back returns to it', async () => {
      // The reported bug: opening a project replaced the home entry, which left
      // the browser's own Back with nothing to go back to.
      navigate(ROUTES.HOME, { replace: true });
      const push = vi.spyOn(history, 'pushState');
      commitSource('https://github.com/o/r', undefined, MANIFEST_FOR);
      await drainAsync();

      expect(push).toHaveBeenCalledTimes(1);
      expect(ROUTE_PATH.value).toBe(ROUTES.CITY);
      push.mockRestore();
    });

    it('replaces when already on a city, since a re-scan is the same place', async () => {
      navigate('/city?src=https://github.com/o/r', { replace: true });
      CURRENT_SOURCE.value = null;
      const push = vi.spyOn(history, 'pushState');
      commitSource('https://github.com/o/other', undefined, MANIFEST_FOR);
      await drainAsync();

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
