import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RECENTS, attachRecents } from '@/state/stores/recents';
import { clearSourceUrl, attachUrlBinding } from '@/router/urlBinding';
import { sourceKey } from '@/utils/sources';
import { makeSession } from '../../../_helpers/city';
import type { CitySession } from '@/city/session/session';
import type { Manifest } from '@/types';
import { navigate, HREF, ROUTE_PATH, ROUTE_PARAMS } from '@/router/location';
import { ROUTES } from '@/router/paths';

describe("a session's source, and what the URL makes of it", () => {
  let session: CitySession;
  let stopUrl: () => void;

  beforeEach(() => {
    session = makeSession();
    stopUrl = attachUrlBinding(session);
  });

  afterEach(() => {
    stopUrl();
    history.replaceState(null, '', '/');
  });

  it('is null when no source is applied', () => {
    session.source.current.value = null;
    expect(session.source.key.value).toBeNull();
  });

  it('derives the hash from the applied source', () => {
    session.source.current.value = { src: '/foo', branch: 'main' };
    expect(session.source.key.value).toBe(sourceKey('/foo', 'main'));
  });

  it('syncs the applied source into the page URL', () => {
    session.source.current.value = { src: 'https://github.com/o/r', branch: 'dev' };
    const u = new URL(window.location.href);
    expect(u.searchParams.get('src')).toBe('https://github.com/o/r');
    expect(u.searchParams.get('branch')).toBe('dev');
  });

  it('omits branch in the URL when none is applied', () => {
    session.source.current.value = { src: '/foo' };
    const u = new URL(window.location.href);
    expect(u.searchParams.get('src')).toBe('/foo');
    expect(u.searchParams.has('branch')).toBe(false);
  });
});

describe("a session's source info, derived from its manifest and source", () => {
  let session: CitySession;

  beforeEach(() => {
    session = makeSession();
  });

  it('is empty when nothing is applied', () => {
    session.source.current.value = null;
    session.manifest.set(null);
    expect(session.source.info.value).toEqual({
      label: '',
      branch: undefined,
      sourceUrl: undefined,
      src: undefined,
    });
  });

  it('exposes the git URL as sourceUrl for a git source', () => {
    session.source.current.value = { src: 'https://github.com/o/r', branch: 'main' };
    session.manifest.set({ tree: { name: 'r' }, repo: { branch: 'main' } } as unknown as Manifest);
    expect(session.source.info.value.sourceUrl).toBe('https://github.com/o/r');
    expect(session.source.info.value.branch).toBe('main');
    expect(session.source.info.value.label).toBe('r');
  });

  it('has no sourceUrl for a local path source', () => {
    session.source.current.value = { src: '/Users/me/proj' };
    session.manifest.set({ tree: { name: 'proj' }, repo: {} } as unknown as Manifest);
    expect(session.source.info.value.sourceUrl).toBeUndefined();
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

describe('opening a source', () => {
  let session: CitySession;
  let stopUrl: () => void;
  let stopRecents: () => void;

  beforeEach(() => {
    session = makeSession();
    // The URL is an adapter over a session; recents is the other reaction the
    // app attaches to the city you opened.
    stopUrl = attachUrlBinding(session);
    stopRecents = attachRecents(session);
  });

  afterEach(() => {
    stopUrl();
    stopRecents();
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
      session.source.set('https://github.com/o/r', undefined, MANIFEST_FOR);

      expect(push).toHaveBeenCalledTimes(1);
      expect(ROUTE_PATH.value).toBe(ROUTES.CITY);
      push.mockRestore();
    });

    it('replaces when already on a city, since a re-scan is the same place', () => {
      navigate('/city?src=https://github.com/o/r', { replace: true });
      session.source.current.value = null;
      const push = vi.spyOn(history, 'pushState');
      session.source.set('https://github.com/o/other', undefined, MANIFEST_FOR);

      expect(push).not.toHaveBeenCalled();
      expect(ROUTE_PARAMS.value.get('src')).toBe('https://github.com/o/other');
      push.mockRestore();
    });
  });

  it('resolves the branch once and gives the load ONE identity', () => {
    // Derived twice, the row resolved `main` while CURRENT_SOURCE kept the
    // branchless request, so no row ever matched the source that was loaded.
    session.source.set('https://github.com/o/r', undefined, {
      tree: { name: 'r' },
      repo: { branch: 'main' },
    } as unknown as Manifest);
    expect(session.source.current.value).toEqual({ src: 'https://github.com/o/r', branch: 'main' });
    const recents = RECENTS.value;
    expect(recents[0].src).toBe('https://github.com/o/r');
    expect(recents[0].branch).toBe('main');
    expect(recents[0].branch, 'the row must match the source it just loaded').toBe(
      session.source.current.value!.branch
    );
  });

  it('keeps that one identity when Timeline recommits the same source', () => {
    session.source.set('https://github.com/o/r', undefined, {
      tree: { name: 'r' },
      repo: { branch: 'main' },
    } as unknown as Manifest);
    // Timeline hands back the branch it was loaded with, and the union
    // manifest's detached-ref branch must not displace it.
    session.source.set('https://github.com/o/r', session.source.current.value?.branch, {
      tree: { name: 'r' },
      repo: { branch: '@ 1a2b3c4d' },
    } as unknown as Manifest);

    expect(RECENTS.value.filter((r) => r.src === 'https://github.com/o/r')).toHaveLength(1);
    expect(RECENTS.value[0].branch).toBe('main');
  });

  it('records an explicitly-requested branch', () => {
    session.source.set('https://github.com/o/r', 'dev', {
      tree: { name: 'r' },
      repo: { branch: 'dev' },
    } as unknown as Manifest);
    expect(session.source.current.value).toEqual({ src: 'https://github.com/o/r', branch: 'dev' });
    expect(RECENTS.value[0].branch).toBe('dev');
  });

  it('records a local source with no branch (branch is not part of its identity)', () => {
    // A local worktree scans whatever is checked out; storing that branch would
    // be a lie (it changes on disk), so the recent and CURRENT_SOURCE omit it.
    session.source.set('/Users/me/worktrees/feat-x', undefined, {
      tree: { name: 'owner/codecity' },
      repo: { branch: 'feat/issue-77' },
    } as unknown as Manifest);
    expect(session.source.current.value).toEqual({
      src: '/Users/me/worktrees/feat-x',
      branch: undefined,
    });
    expect(RECENTS.value[0].branch).toBeUndefined();
  });

  it('dedupes a local path across checkouts into one recent', () => {
    // Opening the same local path at two different checkouts must not spawn a
    // second row: both commits store branch: undefined, so they dedupe by src.
    session.source.set('/proj', undefined, {
      tree: { name: 'proj' },
      repo: { branch: 'main' },
    } as unknown as Manifest);
    session.source.set('/proj', undefined, {
      tree: { name: 'proj' },
      repo: { branch: 'feat/x' },
    } as unknown as Manifest);
    expect(RECENTS.value).toHaveLength(1);
    expect(RECENTS.value[0].branch).toBeUndefined();
  });

  it('drops the branch from CURRENT_SOURCE + the URL for a local source', () => {
    // Even if a stale branch is passed in (old deep-link, recents onOpen), a
    // local source never carries it: CURRENT_SOURCE and the page URL stay clean.
    session.source.set('/Users/me/proj', 'stale-branch', {
      tree: { name: 'proj' },
      repo: { branch: 'main' },
    } as unknown as Manifest);
    expect(session.source.current.value).toEqual({ src: '/Users/me/proj', branch: undefined });
    const u = new URL(window.location.href);
    expect(u.searchParams.has('branch')).toBe(false);
  });
});
