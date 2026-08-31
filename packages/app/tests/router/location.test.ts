// The URL signal: what it exposes, and which navigations add a history entry.
// Everything else in the app writes the URL through here.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ROUTE_PATH,
  ROUTE_SEARCH,
  ROUTE_PARAMS,
  navigate,
  setRouteParams,
  hrefFor,
  attachRouteHistory,
} from '@/router/location';
import { ROUTES } from '@/router/location';

describe('router/location', () => {
  beforeEach(() => {
    navigate(ROUTES.HOME, { replace: true });
  });

  it('splits the href into path, search and params', () => {
    navigate('/city?src=/tmp/repo&mode=timeline');
    expect(ROUTE_PATH.value).toBe('/city');
    // The literal query as navigated to; parsing is ROUTE_PARAMS' job.
    expect(ROUTE_SEARCH.value).toBe('src=/tmp/repo&mode=timeline');
    expect(ROUTE_PARAMS.value.get('src')).toBe('/tmp/repo');
    expect(ROUTE_PARAMS.value.get('mode')).toBe('timeline');
  });

  it('reports no search for a bare path', () => {
    navigate('/city');
    expect(ROUTE_SEARCH.value).toBe('');
    expect([...ROUTE_PARAMS.value.keys()]).toEqual([]);
  });

  describe('navigate', () => {
    let push: ReturnType<typeof vi.spyOn>;
    let replace: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      push = vi.spyOn(history, 'pushState');
      replace = vi.spyOn(history, 'replaceState');
    });
    afterEach(() => {
      push.mockRestore();
      replace.mockRestore();
    });

    it('pushes by default and replaces when asked', () => {
      navigate('/city?src=a');
      expect(push).toHaveBeenCalledTimes(1);
      expect(replace).not.toHaveBeenCalled();

      navigate('/city?src=b', { replace: true });
      expect(push).toHaveBeenCalledTimes(1);
      expect(replace).toHaveBeenCalledTimes(1);
      expect(`${ROUTE_PATH.value}${ROUTE_SEARCH.value ? `?${ROUTE_SEARCH.value}` : ''}`).toBe('/city?src=b');
    });

    it('no-ops when the href is unchanged, so a reflection cannot stack entries', () => {
      navigate('/city?src=a');
      push.mockClear();
      navigate('/city?src=a');
      navigate('/city?src=a');
      expect(push).not.toHaveBeenCalled();
    });
  });

  describe('setRouteParams', () => {
    it('rewrites the query and keeps the path', () => {
      navigate('/city?src=a&mode=timeline');
      setRouteParams((p) => {
        p.set('sel', 'file:src/app.ts');
        p.delete('mode');
      });
      expect(ROUTE_PATH.value).toBe('/city');
      expect(ROUTE_PARAMS.value.get('src')).toBe('a');
      expect(ROUTE_PARAMS.value.get('sel')).toBe('file:src/app.ts');
      expect(ROUTE_PARAMS.value.has('mode')).toBe(false);
    });

    it('drops the ? entirely when the last param goes', () => {
      navigate('/city?mode=timeline');
      setRouteParams((p) => p.delete('mode'));
      expect(`${ROUTE_PATH.value}${ROUTE_SEARCH.value ? `?${ROUTE_SEARCH.value}` : ''}`).toBe('/city');
    });

    // A repo path and a node path are most of what this URL says, and form
    // encoding renders both unreadable (/repos/x → %2Frepos%2Fx).
    it('leaves the path and scheme characters readable', () => {
      navigate('/city');
      setRouteParams((p) => {
        p.set('src', '/repos/codecity');
        p.set('sel', 'file:src/app.ts');
      });

      expect(`${ROUTE_PATH.value}${ROUTE_SEARCH.value ? `?${ROUTE_SEARCH.value}` : ''}`).toBe('/city?src=/repos/codecity&sel=file:src/app.ts');
      // Still the values that went in: what the app reads is unchanged.
      expect(ROUTE_PARAMS.value.get('src')).toBe('/repos/codecity');
      expect(ROUTE_PARAMS.value.get('sel')).toBe('file:src/app.ts');
    });

    // & = # would end the value or the query: those stay escaped.
    it('keeps escaping what would change where the value ends', () => {
      navigate('/city');
      setRouteParams((p) => p.set('src', 'https://host/a&b=c#d'));

      expect(`${ROUTE_PATH.value}${ROUTE_SEARCH.value ? `?${ROUTE_SEARCH.value}` : ''}`).toBe('/city?src=https://host/a%26b%3Dc%23d');
      expect(ROUTE_PARAMS.value.get('src')).toBe('https://host/a&b=c#d');
    });
  });

  it('hrefFor joins a path and params, omitting an empty query', () => {
    expect(hrefFor(ROUTES.CITY, new URLSearchParams({ src: 'a' }))).toBe('/city?src=a');
    expect(hrefFor(ROUTES.HOME)).toBe('/');
    expect(hrefFor(ROUTES.CITY, new URLSearchParams())).toBe('/city');
  });

  it('follows the browser on back/forward', () => {
    const detach = attachRouteHistory();
    navigate('/city?src=a');
    history.replaceState(null, '', '/city?src=elsewhere');
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(`${ROUTE_PATH.value}${ROUTE_SEARCH.value ? `?${ROUTE_SEARCH.value}` : ''}`).toBe('/city?src=elsewhere');
    detach();
  });

  it('stops following once detached', () => {
    const detach = attachRouteHistory();
    detach();
    navigate('/city?src=a');
    history.replaceState(null, '', '/city?src=b');
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(`${ROUTE_PATH.value}${ROUTE_SEARCH.value ? `?${ROUTE_SEARCH.value}` : ''}`).toBe('/city?src=a');
  });
});
