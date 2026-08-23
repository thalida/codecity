import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { ControlsPane } from '@/views/CityView/panes/ControlsPane/ControlsPane';
import { SyntaxThemeField } from '@/components/fields/SyntaxThemeField/SyntaxThemeField';
import { SYNTAX_THEME, SYNTAX_THEME_DEFAULT } from '@/state/settings/fields/syntaxTheme';
import { _resetForTests } from '@/state/settings/drafts';
// Load every settings store for its registration side-effect (settingSignal
// registers each store at module-load) so every field renders.
import '@/city/session/settings/updates';
import '@/city/session/settings/scene';
import '@/state/settings/fields/syntaxTheme';
import '@/state/settings/fields/theme';
import '@/city/session/settings/streets';
import '@/city/session/settings/buildings';
import '@/city/session/settings/gem';
import '@/city/session/settings/island';
import '@/city/session/settings/footprint';
import '@/city/session/settings/trees';
import '@/city/session/settings/fireflies';
import '@/city/session/settings/effects';
import { flush } from '../../../../_helpers/preact';

describe('ControlsPane', () => {
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

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    container.remove();
  });

  // Scan settings moved to the header's menu and appearance to the footer's,
  // leaving one subject here and nothing for tabs to choose between.
  it('has no subtabs, just the World sections', () => {
    const pane = mount();
    expect(pane.classList.contains('controls-pane')).toBe(true);
    expect(pane.querySelectorAll('[role="tab"]')).toHaveLength(0);
    expect(pane.querySelectorAll('.controls-section').length).toBeGreaterThan(0);
  });

  // Every field in here is draft-backed, so the footer is unconditional now
  // rather than something only one tab earned.
  it('always shows the action bar', () => {
    const pane = mount();
    expect(pane.querySelector('.controls-actions')).toBeTruthy();
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
    expect(pane.querySelector('.setting-row-rebuild-badge')).toBeNull();
  });

  it('collapsed=true remounts sections at their defaults', async () => {
    const pane = mount({ collapsed: false });
    // Expand the (default-collapsed) sections — a non-default state that the
    // remount-on-collapse must discard.
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
    expect(repane.querySelectorAll('.controls-section.is-open')).toHaveLength(0);
  });
});

describe('subgroup group reset button', () => {
  let container: HTMLDivElement;

  function mount(): HTMLElement {
    act(() => {
      render(<ControlsPane />, container);
    });
    const pane = container.querySelector('.pane') as HTMLElement;
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

describe('SyntaxThemeField', () => {
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
    act(() => render(<SyntaxThemeField />, container));
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
