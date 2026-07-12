import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { ControlsPane } from '@/views/ControlsPane/ControlsPane';
// Load every settings store for its registration side-effect (settingSignal
// registers each store at module-load) so every field renders.
import '@/state/stores/settings/updates';
import '@/state/stores/settings/scene';
import '@/state/stores/settings/syntaxTheme';
import '@/state/stores/settings/streets';
import '@/state/stores/settings/buildings';
import '@/state/stores/settings/gem';
import '@/state/stores/settings/island';
import '@/state/stores/settings/footprint';
import '@/state/stores/settings/trees';
import '@/state/stores/settings/fireflies';
import '@/state/stores/settings/effects';
import { flush } from '../../_helpers/preact';

describe('ControlsPane subtabs', () => {
  let container: HTMLDivElement;

  interface MountOpts {
    onClose?: () => void;
    collapsed?: boolean;
  }

  function mount(opts: MountOpts = {}): HTMLElement {
    act(() => {
      render(<ControlsPane onClose={opts.onClose} collapsed={opts.collapsed} />, container);
    });
    return container.querySelector('.pane') as HTMLElement;
  }

  const tab = (pane: HTMLElement, label: string) =>
    Array.from(pane.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find((el) =>
      el.textContent?.includes(label)
    )!;

  const clickTab = (pane: HTMLElement, label: string) => act(() => tab(pane, label).click());

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    container.remove();
  });

  it('renders exactly three subtabs, World active by default', () => {
    const pane = mount();
    expect(pane.classList.contains('controls-pane')).toBe(true);
    for (const label of ['World', 'Live updates', 'Preview']) {
      expect(tab(pane, label)).toBeTruthy();
    }
    expect(tab(pane, 'Shortcuts')).toBeUndefined();
    expect(tab(pane, 'Debug')).toBeUndefined();
    expect(tab(pane, 'World').getAttribute('aria-selected')).toBe('true');
  });

  it('shows the action bar only on World; Updates/Preview autosave with no footer', () => {
    const pane = mount();
    expect(pane.querySelector('.controls-actions')).toBeTruthy(); // World
    clickTab(pane, 'Live updates');
    expect(pane.querySelector('.controls-actions')).toBeNull();
    clickTab(pane, 'Preview');
    expect(pane.querySelector('.controls-actions')).toBeNull();
  });

  it('renders the Updates section inline, with no collapsible section wrapper', () => {
    const pane = mount();
    clickTab(pane, 'Live updates');
    expect(pane.querySelector('.controls-section')).toBeNull();
    expect(pane.querySelectorAll('.theme-row').length).toBeGreaterThan(0);
  });

  it('renders three action-bar buttons; Save/Discard disabled when clean', () => {
    const pane = mount();
    const buttons = Array.from(
      pane.querySelectorAll<HTMLButtonElement>('.controls-actions .controls-button')
    );
    expect(buttons.length).toBe(3);
    const labels = buttons.map((b) => b.textContent?.trim());
    expect(labels).toContain('Reset all');
    expect(labels).toContain('Discard');
    expect(labels).toContain('Save');
    const save = buttons.find((b) => b.textContent?.trim() === 'Save')!;
    const discard = buttons.find((b) => b.textContent?.trim() === 'Discard')!;
    expect(save.disabled).toBe(true);
    expect(discard.disabled).toBe(true);
  });

  it('does not render any rebuild badges on rows', () => {
    const pane = mount();
    expect(pane.querySelector('.theme-row-rebuild-badge')).toBeNull();
  });

  it('collapsed=true closes all <details> and resets to the World subtab', async () => {
    const pane = mount({ collapsed: false });
    pane.querySelectorAll<HTMLDetailsElement>('details').forEach((d) => (d.open = true));
    clickTab(pane, 'Live updates');
    act(() => {
      render(<ControlsPane onClose={() => {}} collapsed={true} />, container);
    });
    await flush();
    const repane = container.querySelector('.pane') as HTMLElement;
    expect(tab(repane, 'World').getAttribute('aria-selected')).toBe('true');
    const openDetails = Array.from(repane.querySelectorAll<HTMLDetailsElement>('details')).filter(
      (d) => d.open
    );
    expect(openDetails).toHaveLength(0);
  });
});

describe('subgroup group reset button', () => {
  let container: HTMLDivElement;

  function mount(): HTMLElement {
    act(() => {
      render(<ControlsPane />, container);
    });
    return container.querySelector('.pane') as HTMLElement;
  }

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });
  afterEach(() => {
    render(null, container);
    container.remove();
  });

  it('renders a draft-driven group reset for collapsible World subgroups that have fields', () => {
    const pane = mount();
    expect(pane.querySelectorAll('details.theme-subgroup-collapsible').length).toBeGreaterThan(0);
    expect(pane.querySelectorAll('.controls-subgroup-reset').length).toBeGreaterThan(0);
  });

  it('group reset buttons are disabled when nothing differs from default', () => {
    const pane = mount();
    const resetBtns = pane.querySelectorAll<HTMLButtonElement>('.controls-subgroup-reset');
    expect(resetBtns.length).toBeGreaterThan(0);
    for (const b of resetBtns) expect(b.disabled).toBe(true);
  });
});
