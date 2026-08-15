import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  ON_HOME,
  SWITCHER_DISMISSIBLE,
  SWITCHER_SHOWCASE,
  PROJECTS_VIEW_OPTS,
  openProjectsView,
  closeProjectsView,
  OVERLAY_OPEN,
} from '@/state/stores/ui';
import { CURRENT_SOURCE } from '@/state/stores/source';
import { navigate, HREF } from '@/state/route';
import { ROUTES } from '@/constants/routes';

const CITY_HREF = '/city?src=https%3A%2F%2Fgithub.com%2Fo%2Floaded';

beforeEach(() => {
  navigate(ROUTES.HOME, { replace: true });
  PROJECTS_VIEW_OPTS.value = {};
});

afterEach(() => {
  CURRENT_SOURCE.value = null;
});

describe('the switcher as a route', () => {
  it('is open exactly when the route is home', () => {
    expect(ON_HOME.value).toBe(true);
    expect(OVERLAY_OPEN.value).toBe(true);

    navigate(CITY_HREF);
    expect(ON_HOME.value).toBe(false);
    expect(OVERLAY_OPEN.value).toBe(false);
  });

  it('opening carries the caller options and goes home', () => {
    navigate(CITY_HREF);
    openProjectsView({ error: 'nope', prefill: { src: '/tmp/x' } });
    expect(ON_HOME.value).toBe(true);
    expect(PROJECTS_VIEW_OPTS.value.error).toBe('nope');
    expect(PROJECTS_VIEW_OPTS.value.prefill?.src).toBe('/tmp/x');
  });

  it('closing returns to the exact view it covered', () => {
    CURRENT_SOURCE.value = { src: 'https://github.com/o/loaded' };
    navigate(`${CITY_HREF}&mode=timeline&sel=file%3Asrc%2Fapp.ts`);
    const covered = HREF.value;
    openProjectsView();
    expect(ON_HOME.value).toBe(true);

    closeProjectsView();
    expect(HREF.value).toBe(covered);
  });

  it('stays put when there is nothing behind it to go back to', () => {
    // No city loaded: whatever was covered before, leaving would land on a
    // /city route describing a project that is no longer open.
    expect(SWITCHER_DISMISSIBLE.value).toBe(false);
    closeProjectsView();
    expect(ON_HOME.value).toBe(true);
  });
});

describe('SWITCHER_DISMISSIBLE', () => {
  it('follows whether a city is loaded, not what the caller asked for', () => {
    expect(SWITCHER_DISMISSIBLE.value).toBe(false);
    CURRENT_SOURCE.value = { src: 'https://github.com/o/loaded' };
    expect(SWITCHER_DISMISSIBLE.value).toBe(true);
  });

  it('a browser Back onto home over a loaded city is still dismissible', () => {
    // The case a caller-passed flag got wrong: nobody calls openProjectsView on
    // a popstate, so the flag would carry whatever the last open happened to set.
    CURRENT_SOURCE.value = { src: 'https://github.com/o/loaded' };
    navigate(CITY_HREF);
    navigate(ROUTES.HOME); // as a Back would
    expect(ON_HOME.value).toBe(true);
    expect(SWITCHER_DISMISSIBLE.value).toBe(true);
    expect(SWITCHER_SHOWCASE.value).toBe(true);
  });

  it('showcase needs a city behind it, not just the route', () => {
    expect(ON_HOME.value).toBe(true);
    expect(SWITCHER_SHOWCASE.value).toBe(false);
  });
});
