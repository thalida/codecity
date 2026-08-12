import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { ControlsPane } from '@/views/ControlsPane/ControlsPane';
import { FilePreviewSection } from '@/views/ControlsPane/partials/FilePreviewSection';
import { SYNTAX_THEME, SYNTAX_THEME_DEFAULT } from '@/state/stores/settings/syntaxTheme';
import { _resetForTests } from '@/state/settingsDrafts';
// Load every settings store for its registration side-effect (settingSignal
// registers each store at module-load) so every field renders.
import '@/state/stores/settings/updates';
import '@/state/stores/settings/scene';
import '@/state/stores/settings/syntaxTheme';
import '@/state/stores/settings/theme';
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

  // Scan is gone: those settings live in the header's scan menu, under the
  // freshness readout they describe.
  it('renders exactly two subtabs in Appearance, World order with Appearance active by default', () => {
    const pane = mount();
    expect(pane.classList.contains('controls-pane')).toBe(true);
    const labels = Array.from(pane.querySelectorAll('[role="tab"]')).map((t) =>
      t.textContent?.trim()
    );
    expect(labels).toEqual(['Appearance', 'World']);
    expect(tab(pane, 'Scan')).toBeUndefined();
    expect(tab(pane, 'Shortcuts')).toBeUndefined();
    expect(tab(pane, 'Debug')).toBeUndefined();
    expect(tab(pane, 'Appearance').getAttribute('aria-selected')).toBe('true');
  });

  it('shows the action bar only on World; Appearance autosaves with no footer', () => {
    const pane = mount();
    expect(pane.querySelector('.controls-actions')).toBeNull(); // Appearance (default)
    clickTab(pane, 'World');
    expect(pane.querySelector('.controls-actions')).toBeTruthy();
    clickTab(pane, 'Appearance');
    expect(pane.querySelector('.controls-actions')).toBeNull();
  });

  it('renders three action-bar buttons; Save/Discard disabled when clean', () => {
    const pane = mount();
    clickTab(pane, 'World'); // the action bar lives on the draftable World tab
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
    expect(pane.querySelector('.setting-row-rebuild-badge')).toBeNull();
  });

  it('collapsed=true remounts sections at their defaults and resets to the default subtab', async () => {
    const pane = mount({ collapsed: false });
    // Move to World and expand its (default-collapsed) sections — a non-default
    // state that the remount-on-collapse must discard.
    clickTab(pane, 'World');
    pane.querySelectorAll<HTMLButtonElement>('.controls-disclosure-toggle').forEach((b) => {
      if (b.getAttribute('aria-expanded') === 'false') b.click();
    });
    await flush();
    expect(pane.querySelectorAll('.controls-section.is-open').length).toBeGreaterThan(0);

    act(() => {
      render(<ControlsPane onClose={() => {}} collapsed={true} />, container);
    });
    await flush();
    const repane = container.querySelector('.pane') as HTMLElement;
    // Reset to Appearance, whose sections are defaultOpen — so exactly those
    // reopen, and none of the World sections stay expanded.
    expect(tab(repane, 'Appearance').getAttribute('aria-selected')).toBe('true');
    expect(repane.querySelectorAll('.controls-section.is-open').length).toBe(2);
  });
});

describe('subgroup group reset button', () => {
  let container: HTMLDivElement;

  function mount(): HTMLElement {
    act(() => {
      render(<ControlsPane />, container);
    });
    const pane = container.querySelector('.pane') as HTMLElement;
    // These tests inspect World-tab subgroups; Scan is the default tab now.
    act(() => {
      Array.from(pane.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
        .find((t) => t.textContent?.includes('World'))
        ?.click();
    });
    // Sections mount their body on first open, so the subgroups only exist once
    // the sections are opened.
    act(() => {
      pane
        .querySelectorAll<HTMLButtonElement>(
          '.controls-section-summary .controls-disclosure-toggle'
        )
        .forEach((t) => t.click());
    });
    return pane;
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
    expect(pane.querySelectorAll('.setting-subgroup-collapsible').length).toBeGreaterThan(0);
    expect(pane.querySelectorAll('.controls-subgroup-reset').length).toBeGreaterThan(0);
  });

  it('group reset buttons are disabled when nothing differs from default', () => {
    const pane = mount();
    const resetBtns = pane.querySelectorAll<HTMLButtonElement>('.controls-subgroup-reset');
    expect(resetBtns.length).toBeGreaterThan(0);
    for (const b of resetBtns) expect(b.disabled).toBe(true);
  });
});

describe('FilePreviewSection', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    SYNTAX_THEME.value = SYNTAX_THEME_DEFAULT;
    _resetForTests();
  });

  afterEach(() => {
    render(null, container);
    container.remove();
  });

  // Appearance autosaves: no Save step, the store takes the value on change.
  it('applies the picked theme immediately', async () => {
    act(() => render(<FilePreviewSection />, container));
    const select = container.querySelector('select') as HTMLSelectElement;
    expect(select).toBeTruthy();

    act(() => {
      select.value = 'monokai';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush();

    expect(SYNTAX_THEME.value).toBe('monokai');
  });
});
