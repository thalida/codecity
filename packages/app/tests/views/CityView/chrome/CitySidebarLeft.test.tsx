import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { CitySidebarLeft } from '@/features/city/components/CitySidebarLeft/CitySidebarLeft';
import type { Manifest } from '@codecity/city';
import { CURRENT_SOURCE } from '@/state/source';
import { createCityChrome, type CityChromeState } from '@/features/city/state/sidebar';
import { renderWithCity, type FakeCity } from '../../../_helpers/cityChrome';
import { drainAsync } from '../../../_helpers/preact';

const TEST_TREE = {
  name: 'project',
  type: 'directory',
  path: '.',
  children: [{ name: 'a.ts', type: 'file', path: 'a.ts', extension: '.ts', size: 100, lines: 10 }],
};

describe('CitySidebarLeft', () => {
  let container: HTMLDivElement;
  let city: FakeCity;
  // Per test, so opening the sidebar in one leaves it open for none of them.
  let chrome: CityChromeState;

  beforeEach(async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    chrome = createCityChrome();
    city = renderWithCity(<CitySidebarLeft />, container, undefined, chrome);
    city.setManifest({ tree: TEST_TREE } as unknown as Manifest);
    render(null, container);
    renderWithCity(<CitySidebarLeft />, container, city, chrome);
    await drainAsync();
  });

  afterEach(() => {
    render(null, container);
    document.body.removeChild(container);
    CURRENT_SOURCE.value = null;
  });

  it('mounts an activity bar with one icon per tab', () => {
    const icons = container.querySelectorAll<HTMLButtonElement>('.activity-bar .activity-bar-icon');
    expect(icons.length).toBe(4);
    expect(icons[0].dataset.tab).toBe('info');
    expect(icons[1].dataset.tab).toBe('explore');
    expect(icons[2].dataset.tab).toBe('search');
    expect(icons[3].dataset.tab).toBe('controls');
  });

  it('places Controls in the bottom activity-bar group, others in the top', () => {
    const top = container.querySelectorAll<HTMLButtonElement>(
      '.activity-bar-top .activity-bar-icon'
    );
    const bottom = container.querySelectorAll<HTMLButtonElement>(
      '.activity-bar-bottom .activity-bar-icon'
    );
    expect(Array.from(top).map((b) => b.dataset.tab)).toEqual(['info', 'explore', 'search']);
    expect(Array.from(bottom).map((b) => b.dataset.tab)).toEqual(['controls']);
  });

  it('starts collapsed by default, with no active tab', () => {
    // The sidebar opens closed so a fresh load shows the city unobscured.
    expect(container.querySelector('#city-sidebar-left')!.classList.contains('is-collapsed')).toBe(
      true
    );
    expect(container.querySelector('.activity-bar-icon.active')).toBeNull();
    // Info is still the default tab (its pane is mounted, just hidden), so
    // opening the sidebar lands on the almanac; inactive tabs aren't rendered.
    expect(container.querySelector('.info-pane')).not.toBeNull();
    expect(container.querySelector('.controls-pane')).toBeNull();
  });

  it('switches panes when an icon is clicked', async () => {
    const controlsBtn = container.querySelector<HTMLButtonElement>(
      '.activity-bar-icon[data-tab="controls"]'
    )!;
    controlsBtn.click();
    await drainAsync();

    expect(container.querySelector('.info-pane')).toBeNull();
    expect(container.querySelector('.controls-pane')).not.toBeNull();
    expect(
      container
        .querySelector('.activity-bar-icon[data-tab="controls"]')!
        .classList.contains('active')
    ).toBe(true);
  });

  it('collapses and resets to Info on world load (open state not remembered)', async () => {
    // Open the sidebar on a non-default tab.
    container.querySelector<HTMLButtonElement>('.activity-bar-icon[data-tab="explore"]')!.click();
    await drainAsync();
    expect(container.querySelector('#city-sidebar-left')!.classList.contains('is-collapsed')).toBe(
      false
    );
    expect(container.querySelector('.explore-pane')).not.toBeNull();
    // A world commits (cold-boot ?src= or a user switch both write CURRENT_SOURCE)
    // → force closed and reset to Info; the open state is not carried over.
    CURRENT_SOURCE.value = { src: 'github.com/o/r' };
    // Two-hop settle: CURRENT_SOURCE → effect → activeTab/collapsed → re-render.
    await drainAsync();
    expect(container.querySelector('#city-sidebar-left')!.classList.contains('is-collapsed')).toBe(
      true
    );
    expect(container.querySelector('.activity-bar-icon.active')).toBeNull();
    expect(container.querySelector('.explore-pane')).toBeNull();
    expect(container.querySelector('.info-pane')).not.toBeNull();
  });
});
