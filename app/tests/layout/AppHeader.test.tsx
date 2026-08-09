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

  it('puts about and the shortcuts button in the meta cluster', async () => {
    loadProject();
    render(<AppHeader />, container);
    await flush();

    const meta = container.querySelector('#app-header-meta')!;
    expect(meta).not.toBeNull();

    const about = meta.querySelector<HTMLAnchorElement>('a')!;
    expect(about.textContent).toBe('about');
    expect(about.getAttribute('href')).toBe('https://github.com/thalida/codecity');
    expect(about.getAttribute('target')).toBe('_blank');
    expect(about.getAttribute('rel')).toBe('noopener noreferrer');

    expect(meta.querySelector('[aria-label="Keyboard shortcuts"]')).not.toBeNull();
  });

  it('has no reset-view control', async () => {
    loadProject();
    render(<AppHeader />, container);
    await flush();

    expect(container.querySelector('[aria-label="Reset view"]')).toBeNull();
  });
});
