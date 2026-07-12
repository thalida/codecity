import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { LeftSidebar } from '@/layout/LeftSidebar/LeftSidebar';
import { SCENE_HANDLE } from '@/state/stores/scene';
import { setManifest } from '@/state/stores/manifest';
import { CURRENT_SOURCE } from '@/state/stores/source';
import { EMPTY_MANIFEST } from '@/constants/manifest';
import { flush, drainAsync } from '../_helpers/preact';

const TEST_TREE = {
  name: 'project',
  type: 'directory',
  path: '.',
  children: [{ name: 'a.ts', type: 'file', path: 'a.ts', extension: '.ts', size: 100, lines: 10 }],
};

// Minimal SCENE_HANDLE stand-in so the sidebar's manifest bridge picks
// up a tree to render. The Preact panes only read getManifest() +
// subscribe to onChange — none of the other handle methods are touched
// in these structural tests.
function makeSceneHandle() {
  return {
    world: {
      getManifest() {
        return { tree: TEST_TREE };
      },
    },
    picker: {
      selection: { value: null, peek: () => null, subscribe: () => () => {} },
      hover: { value: null, peek: () => null, subscribe: () => () => {} },
      selectByPath() {},
      setHover() {},
    },
  };
}

describe('LeftSidebar', () => {
  let container: HTMLDivElement;

  beforeEach(async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    // Seed MANIFEST directly (the fetch layer is the writer now that the
    // scene→MANIFEST bridge is gone) so the sidebar has a tree to render.
    // SCENE_HANDLE is still seeded for the picker the panes read.
    setManifest({ tree: TEST_TREE } as never);
    SCENE_HANDLE.value = makeSceneHandle() as never;
    render(<LeftSidebar />, container);
    await flush();
  });

  afterEach(() => {
    render(null, container);
    document.body.removeChild(container);
    SCENE_HANDLE.value = null;
    setManifest(EMPTY_MANIFEST as never);
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
    expect(container.querySelector('#left-sidebar')!.classList.contains('is-collapsed')).toBe(true);
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
    await flush();

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
    await flush();
    expect(container.querySelector('#left-sidebar')!.classList.contains('is-collapsed')).toBe(
      false
    );
    expect(container.querySelector('.explore-pane')).not.toBeNull();
    // A world commits (cold-boot ?src= or a user switch both write CURRENT_SOURCE)
    // → force closed and reset to Info; the open state is not carried over.
    CURRENT_SOURCE.value = { src: 'github.com/o/r' };
    // Two-hop settle: CURRENT_SOURCE → effect → activeTab/collapsed → re-render.
    await drainAsync();
    expect(container.querySelector('#left-sidebar')!.classList.contains('is-collapsed')).toBe(true);
    expect(container.querySelector('.activity-bar-icon.active')).toBeNull();
    expect(container.querySelector('.explore-pane')).toBeNull();
    expect(container.querySelector('.info-pane')).not.toBeNull();
  });
});
