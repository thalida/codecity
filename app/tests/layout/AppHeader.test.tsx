import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { AppHeader } from '@/layout/AppHeader/AppHeader';
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

describe('AppHeader', () => {
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
    render(<AppHeader />, container);
    await flush();

    const chip = container.querySelector('.btn-chip');
    expect(chip).not.toBeNull();
    expect(chip!.querySelector('.gem-icon')).not.toBeNull();
    expect(chip!.textContent).toContain('codecity');
  });

  it('opens the switcher when the chip is clicked', async () => {
    const onSwitchSource = vi.fn();
    loadProject();
    render(<AppHeader onSwitchSource={onSwitchSource} />, container);
    await flush();

    container.querySelector<HTMLButtonElement>('.btn-chip')!.click();
    await flush();

    expect(onSwitchSource).toHaveBeenCalledTimes(1);
  });

  it('still renders the gem before a project loads', async () => {
    render(<AppHeader />, container);
    await flush();

    const chip = container.querySelector('.btn-chip');
    expect(chip).not.toBeNull();
    expect(chip!.querySelector('.gem-icon')).not.toBeNull();
  });

  // The header is the project, the footer is the app. Neither of these is
  // about the repo you have open, so both moved down.
  it('holds neither the about link nor the shortcuts button', async () => {
    loadProject();
    render(<AppHeader />, container);
    await flush();

    expect(container.querySelector('[aria-label="Keyboard shortcuts"]')).toBeNull();
    expect(container.querySelector('a[href="https://github.com/thalida/codecity"]')).toBeNull();
  });

  it('puts the freshness readout and refresh together, opposite the project', async () => {
    loadProject();
    render(<AppHeader />, container);
    await flush();

    const freshness = container.querySelector('.app-header-freshness')!;
    expect(freshness).not.toBeNull();
    // A readout parked in the opposite corner from its own button is the
    // mistake this resort exists to fix, so they share one cluster.
    expect(freshness.querySelector('.freshness-status')).not.toBeNull();
    expect(freshness.querySelector('[aria-label="Refresh"]')).not.toBeNull();
    expect(freshness.classList.contains('chrome-cluster')).toBe(true);
  });

  it('groups the project controls in one outlined cluster', async () => {
    loadProject();
    render(<AppHeader />, container);
    await flush();

    const cluster = container.querySelector('.chrome-cluster')!;
    expect(cluster.querySelector('.gem-icon')).not.toBeNull();
    expect(cluster.querySelector('[aria-label="Copy repo source"]')).not.toBeNull();
  });

  it('offers refresh and fresh scan with the same words for any source', async () => {
    loadProject();
    const onRefresh = vi.fn();
    render(<AppHeader onRefresh={onRefresh} />, container);
    await flush();

    container.querySelector<HTMLButtonElement>('.split-button-caret')!.click();
    await flush();
    const items = Array.from(container.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    expect(items.map((el) => el.querySelector('.split-button-item-label')?.textContent)).toEqual([
      'Refresh',
      'Fresh scan',
    ]);

    items[1].click();
    expect(onRefresh).toHaveBeenCalledWith(true);
  });

  it('shows nothing to refresh before a project is loaded', async () => {
    render(<AppHeader />, container);
    await flush();
    expect(container.querySelector('.app-header-freshness')).toBeNull();
  });

  it('has no reset-view control', async () => {
    loadProject();
    render(<AppHeader />, container);
    await flush();

    expect(container.querySelector('[aria-label="Reset view"]')).toBeNull();
  });
});
