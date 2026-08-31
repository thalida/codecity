// The Live/Timeline toggle. It does not load anything: it writes where the
// reader wants to be into the URL, and the city follows that down as a prop.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import type { Manifest } from '@codecity/city';

import { TimelineToggle } from '@/features/city/components/TimelineToggle/TimelineToggle';
import { CURRENT_SOURCE } from '@/state/source';
import { navigate, ROUTES, ROUTE_PARAMS } from '@/router/location';
import { renderWithCity, type FakeCity } from '../_helpers/cityChrome';
import { drainAsync } from '../_helpers/preact';

const TEST_MANIFEST = {
  tree: { name: 'project', type: 'directory', path: '.', children: [] },
  repo: { remote_url: null, branch: 'main' },
} as unknown as Manifest;

function btns(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('.timeline-toggle-btn'));
}

describe('TimelineToggle', () => {
  let container: HTMLDivElement;
  let city: FakeCity | undefined;

  /** Mount the toggle over a city, optionally already showing something. */
  async function mount(showing = false): Promise<void> {
    city = renderWithCity(<TimelineToggle />, container, city);
    if (showing) {
      CURRENT_SOURCE.value = { src: '/repo' };
      city.setManifest(TEST_MANIFEST);
      render(null, container);
      city = renderWithCity(<TimelineToggle />, container, city);
    }
    await drainAsync();
  }

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    city = undefined;
    navigate(ROUTES.CITY, { replace: true });
  });

  afterEach(() => {
    render(null, container);
    container.remove();
    CURRENT_SOURCE.value = null;
    navigate(ROUTES.HOME, { replace: true });
  });

  it('does not render before a source is loaded', async () => {
    await mount();
    expect(container.querySelector('.timeline-toggle')).toBeNull();
  });

  it('renders once a source is loaded, Live active by default', async () => {
    await mount(true);

    const [live, timeline] = btns(container);
    expect(live.textContent).toBe('Live');
    expect(live.classList.contains('is-active')).toBe(true);
    expect(timeline.classList.contains('is-active')).toBe(false);
  });

  it('follows the city into Timeline', async () => {
    await mount(true);
    city!.timeline.enter();
    await drainAsync();

    const [live, timeline] = btns(container);
    expect(timeline.classList.contains('is-active')).toBe(true);
    expect(live.classList.contains('is-active')).toBe(false);
  });

  it('asks for Timeline by writing it into the URL', async () => {
    await mount(true);

    btns(container)[1]!.click();
    await drainAsync();

    expect(ROUTE_PARAMS.value.get('mode')).toBe('timeline');
  });

  it('asks for Live by taking it back out', async () => {
    await mount(true);
    city!.timeline.enter();
    await drainAsync();

    btns(container)[0]!.click();
    await drainAsync();

    expect(ROUTE_PARAMS.value.has('mode')).toBe(false);
  });

  it('does nothing when you press the mode you are already in', async () => {
    await mount(true);

    btns(container)[0]!.click(); // Live, while live
    await drainAsync();

    expect(ROUTE_PARAMS.value.has('mode')).toBe(false);
  });
});
