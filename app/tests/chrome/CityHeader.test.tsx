import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { CityHeader } from '@/chrome/CityHeader/CityHeader';
import { CURRENT_SOURCE } from '@/state/stores/source';
import { setManifest } from '@/state/stores/manifest';
import { EMPTY_MANIFEST } from '@/constants/manifest';
import type { Manifest } from '@/types';
import { flush } from '../_helpers/preact';

const LOADED: Manifest = {
  ...EMPTY_MANIFEST,
  tree: { ...EMPTY_MANIFEST.tree, name: 'codecity' },
};

function loadProject() {
  setManifest(LOADED);
  CURRENT_SOURCE.value = { src: '/repos/codecity', branch: 'main' };
}

describe('CityHeader', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    document.body.removeChild(container);
    CURRENT_SOURCE.value = null;
    setManifest(EMPTY_MANIFEST);
  });

  it('renders the gem inside the project chip', async () => {
    loadProject();
    render(<CityHeader />, container);
    await flush();

    const chip = container.querySelector('.project-switcher');
    expect(chip).not.toBeNull();
    expect(chip!.querySelector('.gem-icon')).not.toBeNull();
    expect(chip!.textContent).toContain('codecity');
  });

  it('opens the switcher when the chip is clicked', async () => {
    const onSwitchSource = vi.fn();
    loadProject();
    render(<CityHeader onSwitchSource={onSwitchSource} />, container);
    await flush();

    container.querySelector<HTMLButtonElement>('.project-switcher')!.click();
    await flush();

    expect(onSwitchSource).toHaveBeenCalledTimes(1);
  });

  it('still renders the gem before a project loads', async () => {
    render(<CityHeader />, container);
    await flush();

    const chip = container.querySelector('.project-switcher');
    expect(chip).not.toBeNull();
    expect(chip!.querySelector('.gem-icon')).not.toBeNull();
  });

  // The header is the project, the footer is the app. Neither of these is about
  // the repo you have open.
  it('holds neither the about link nor the shortcuts button', async () => {
    loadProject();
    render(<CityHeader />, container);
    await flush();

    expect(container.querySelector('[aria-label="Keyboard shortcuts"]')).toBeNull();
    expect(container.querySelector('a[href="https://github.com/thalida/codecity"]')).toBeNull();
  });

  it('puts the freshness readout opposite the project, with nothing beside it', async () => {
    loadProject();
    render(<CityHeader />, container);
    await flush();

    const freshness = container.querySelector('.app-header-freshness')!;
    expect(freshness).not.toBeNull();
    expect(freshness.querySelector('.freshness-status')).not.toBeNull();
    expect(freshness.classList.contains('chrome-cluster')).toBe(true);
    // The readout is the whole cluster: acting on it happens in its panel, so a
    // second item in the bar would be a duplicate of a row in there.
    expect(freshness.querySelectorAll('.cluster-item')).toHaveLength(1);
  });

  // The trigger and its panel are siblings, so the cluster's dividers and
  // end-rounding still apply to the trigger; a wrapper would break both.
  it('makes the readout a direct child of the cluster, not a wrapped one', async () => {
    loadProject();
    render(<CityHeader />, container);
    await flush();

    const cluster = container.querySelector('.app-header-freshness')!;
    const trigger = cluster.querySelector('.scan-menu-trigger')!;
    expect(trigger.parentElement).toBe(cluster);
  });

  // The gem says which app this is; this says which kind of repo the name
  // beside it belongs to, the way every row in the switcher already does.
  it('marks the chip with the repo kind, and drops it before a project loads', async () => {
    render(<CityHeader />, container);
    await flush();
    expect(container.querySelector('.project-switcher-kind')).toBeNull();

    loadProject();
    render(<CityHeader />, container);
    await flush();
    expect(container.querySelector('.project-switcher-kind .icon')).not.toBeNull();
  });

  it('groups the project controls in one outlined cluster', async () => {
    loadProject();
    render(<CityHeader />, container);
    await flush();

    const cluster = container.querySelector('.chrome-cluster')!;
    expect(cluster.querySelector('.gem-icon')).not.toBeNull();
    expect(cluster.querySelector('[aria-label="Copy repo source"]')).not.toBeNull();
  });

  it('holds both ways to re-open the source in the panel, and none in the bar', async () => {
    loadProject();
    const onRefresh = vi.fn();
    render(<CityHeader onRefresh={onRefresh} />, container);
    await flush();

    expect(container.querySelector('[aria-label="Refresh"]')).toBeNull();

    container.querySelector<HTMLButtonElement>('.scan-menu-trigger')!.click();
    await flush();
    const actions = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.popover-panel .scan-menu-action')
    );
    expect(actions.map((el) => el.querySelector('.scan-menu-action-label')?.textContent)).toEqual([
      'Reload',
      'Fresh scan',
    ]);

    // Cheapest first, and the cache flag is the only thing between them.
    actions[0].click();
    expect(onRefresh).toHaveBeenCalledWith(false);
  });

  it('shows nothing to refresh before a project is loaded', async () => {
    render(<CityHeader />, container);
    await flush();
    expect(container.querySelector('.app-header-freshness')).toBeNull();
  });

  it('has no reset-view control', async () => {
    loadProject();
    render(<CityHeader />, container);
    await flush();

    expect(container.querySelector('[aria-label="Reset view"]')).toBeNull();
  });
});
