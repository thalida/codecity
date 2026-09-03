// The composition root. Each view has its own suite; what is only true here is
// which view a URL puts on the screen, and that a bad one lands somewhere.
// Every part can pass and the assembly still be wrong.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';

// jsdom has no WebGL, and none of this is about the scene.
vi.mock('@/components/City/City', () => ({
  City: () => null,
  CityVariant: { Scene: 'scene', Backdrop: 'backdrop' },
}));

vi.mock('@/features/home/HomeView', () => ({
  HomeView: () => <div data-view="home" />,
}));
vi.mock('@/features/city/CityView', () => ({
  CityView: () => <div data-view="city" />,
}));

import { App } from '@/app/App';
import { ROUTES, navigate, cityHref } from '@/router/location';
import { CURRENT_SOURCE, SOURCE_ERROR } from '@/state/source';
import { renderWithServer } from '../_helpers/query';
import { drainAsync } from '../_helpers/preact';

/** Go somewhere the way the app does: the router reads its own signal, which
 *  history alone does not touch. */
async function at(href: string): Promise<void> {
  navigate(href);
  await drainAsync();
}

function viewIn(host: HTMLElement): string | null {
  return host.querySelector<HTMLElement>('[data-view]')?.dataset.view ?? null;
}

describe('App', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    document.body.removeChild(container);
    CURRENT_SOURCE.value = null;
    SOURCE_ERROR.value = null;
    navigate(ROUTES.HOME);
  });

  it('puts the landing on /', async () => {
    renderWithServer(<App />, container);
    await at(ROUTES.HOME);

    expect(viewIn(container)).toBe('home');
  });

  it('puts the city on /city', async () => {
    CURRENT_SOURCE.value = { src: 'https://github.com/o/r' };
    renderWithServer(<App />, container);
    await at(cityHref('https://github.com/o/r'));

    expect(viewIn(container)).toBe('city');
  });

  // A URL nobody routes still has to land somewhere a person can act.
  it('sends an unknown path to the landing', async () => {
    renderWithServer(<App />, container);
    await at('/nowhere');

    expect(viewIn(container)).toBe('home');
  });

  // The reaction that outlives both routes: a load that failed belongs on the
  // landing, which is the screen that explains what happened.
  it('leaves the city for the landing when the source fails', async () => {
    CURRENT_SOURCE.value = { src: 'https://github.com/o/r' };
    renderWithServer(<App />, container);
    await at(cityHref('https://github.com/o/r'));
    expect(viewIn(container)).toBe('city');

    SOURCE_ERROR.value = { error: 'not a repo' };
    await drainAsync();

    expect(viewIn(container)).toBe('home');
  });
});
