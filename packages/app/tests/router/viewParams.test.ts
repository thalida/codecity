import { describe, it, expect, afterEach } from 'vitest';
import { readUrlView } from '@/router/viewParams';
import { normalizeBootRoute, HREF, navigate, ROUTE_PARAMS } from '@/router/location';
import { ROUTES } from '@/router/paths';
import { NodeKind } from '@codecity/city';

function boot(href: string) {
  navigate(href, { replace: true });
  normalizeBootRoute();
}

describe('normalizeBootRoute', () => {
  afterEach(() => {
    navigate(ROUTES.HOME, { replace: true });
  });

  it('lands on home when there is no ?src to load', () => {
    boot('/');
    expect(HREF.value).toBe(ROUTES.HOME);
  });

  // Links minted before /city existed carry ?src at the root, escaped; the
  // rewrite hands back the readable form (location.ts queryString), same value.
  it('moves a rooted ?src onto /city, params intact', () => {
    boot('/?src=https%3A%2F%2Fgithub.com%2Fpreactjs%2Fpreact');
    expect(HREF.value).toBe('/city?src=https://github.com/preactjs/preact');
  });

  it('carries every view param across the move', () => {
    boot('/?src=%2Frepos%2Fcodecity&branch=main&mode=timeline&commit=abc&sel=file%3Aa.ts');
    expect(HREF.value).toBe(
      '/city?src=/repos/codecity&branch=main&mode=timeline&commit=abc&sel=file:a.ts'
    );
  });

  it('leaves a ?src already on /city alone', () => {
    boot('/city?src=%2Frepos%2Fcodecity');
    expect(HREF.value).toBe('/city?src=%2Frepos%2Fcodecity');
  });

  it('sends a /city with no project home, since there is nothing to show', () => {
    boot('/city');
    expect(HREF.value).toBe(ROUTES.HOME);
  });
});

describe('readUrlView', () => {
  const read = (search: string) => {
    navigate(`/city${search}`, { replace: true });
    return readUrlView(ROUTE_PARAMS.peek());
  };

  afterEach(() => {
    navigate(ROUTES.HOME, { replace: true });
  });

  it('reads the view the URL asks for', () => {
    const boot = read('?src=%2Frepos%2Fcodecity&mode=timeline&commit=abc123&sel=file:app/main.tsx');
    expect(boot).toEqual({
      src: '/repos/codecity',
      branch: undefined,
      timeline: true,
      commit: 'abc123',
      selection: { kind: NodeKind.File, path: 'app/main.tsx' },
    });
  });

  it('reads a bare source as Live at the present with nothing selected', () => {
    expect(read('?src=%2Frepos%2Fcodecity')).toEqual({
      src: '/repos/codecity',
      branch: undefined,
      timeline: false,
      commit: null,
      selection: null,
    });
  });

  it('names a directory and a commit selection by their own kinds', () => {
    expect(read('?src=%2Fr&sel=dir:app/src').selection).toEqual({
      kind: NodeKind.Directory,
      path: 'app/src',
    });
    expect(read('?src=%2Fr&sel=commit:abc123').selection).toEqual({
      kind: NodeKind.Commit,
      sha: 'abc123',
    });
  });

  it('ignores a selection it cannot read', () => {
    expect(read('?src=%2Fr&sel=nonsense').selection).toBeNull();
    expect(read('?src=%2Fr&sel=file:').selection).toBeNull();
    expect(read('?src=%2Fr&sel=:app/main.tsx').selection).toBeNull();
  });

  // A local checkout has no branch axis, so a stale ?branch can't split its
  // identity from the source that loads.
  it('drops a branch a local source cannot have', () => {
    expect(read('?src=%2Frepos%2Fcodecity&branch=stale').branch).toBeUndefined();
    expect(read('?src=https%3A%2F%2Fgithub.com%2Fo%2Fr&branch=dev').branch).toBe('dev');
  });
});
