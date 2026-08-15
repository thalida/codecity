import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ON_HOME, HOME_OPTS, goHome, OVERLAY_OPEN } from '@/state/stores/ui';
import { CURRENT_SOURCE } from '@/state/stores/source';
import { navigate, HREF } from '@/router/location';
import { ROUTES } from '@/router/paths';

const CITY_HREF = '/city?src=https%3A%2F%2Fgithub.com%2Fo%2Floaded';

beforeEach(() => {
  navigate(ROUTES.HOME, { replace: true });
  HOME_OPTS.value = {};
});

afterEach(() => {
  CURRENT_SOURCE.value = null;
});

describe('home as a route', () => {
  it('is the landing exactly when the route says so', () => {
    expect(ON_HOME.value).toBe(true);
    navigate(CITY_HREF);
    expect(ON_HOME.value).toBe(false);
  });

  it('carries the caller options and navigates', () => {
    navigate(CITY_HREF);
    goHome({ error: 'nope', prefill: { src: '/tmp/x' } });
    expect(ON_HOME.value).toBe(true);
    expect(HOME_OPTS.value.error).toBe('nope');
    expect(HOME_OPTS.value.prefill?.src).toBe('/tmp/x');
  });

  it('pushes rather than replacing, so the city stays behind it in history', () => {
    navigate(CITY_HREF);
    const pushes: string[] = [];
    const spy = (to: string) => pushes.push(to);
    const original = history.pushState.bind(history);
    history.pushState = ((s: unknown, t: string, url: string) => {
      spy(url);
      return original(s, t, url);
    }) as typeof history.pushState;
    goHome();
    history.pushState = original;
    expect(pushes).toEqual([ROUTES.HOME]);
    expect(HREF.value).toBe(ROUTES.HOME);
  });
});

describe('OVERLAY_OPEN', () => {
  it('is true on the landing, whose backdrop canvas must not take keystrokes', () => {
    expect(ON_HOME.value).toBe(true);
    expect(OVERLAY_OPEN.value).toBe(true);
  });

  it('is false on the city, where the scene owns the keyboard', () => {
    navigate(CITY_HREF);
    expect(OVERLAY_OPEN.value).toBe(false);
  });
});
