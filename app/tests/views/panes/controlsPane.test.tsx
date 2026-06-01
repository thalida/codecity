import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { ControlsPane } from '@/views/panes/ControlsPane';
// Importing the settings barrel triggers every persistedSignal() registration
// at module-load (used by getDefault / forEachRegisteredStore inside the
// controls sections).
import '@/state/stores/settings/index';
import { flush } from '../../_helpers/preact';

describe('ControlsPane', () => {
  let container: HTMLDivElement;

  interface MountOpts {
    onClose?: () => void;
    onRunCollisionCheck?: () => void;
    onRunStemDiagnostic?: () => void;
    collapsed?: boolean;
  }

  // Renders <ControlsPane> into the test container and returns the `.pane`
  // element (mirrors the old buildControlsPane().pane). act() flushes
  // Preact's effect queue so the collapsed-driven useEffect is live.
  function mount(opts: MountOpts = {}): HTMLElement {
    act(() => {
      render(
        <ControlsPane
          onClose={opts.onClose}
          onRunCollisionCheck={opts.onRunCollisionCheck}
          onRunStemDiagnostic={opts.onRunStemDiagnostic}
          collapsed={opts.collapsed}
        />,
        container
      );
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

  it('returns a pane with the Settings header + Keyboard & mouse section first', () => {
    const pane = mount();
    expect(pane.classList.contains('controls-pane')).toBe(true);
    expect(pane.querySelector<HTMLElement>('.text-pane-title')!.textContent).toBe('Settings');
    expect(
      pane.querySelector<HTMLElement>('.controls-section-summary .text-label')!.textContent
    ).toBe('Keyboard & mouse');
  });

  it('renders a shortcuts list in the Keyboard & mouse section', () => {
    const pane = mount();
    const shortcuts = pane.querySelector<HTMLElement>('.shortcuts-list');
    expect(shortcuts).not.toBeNull();
    // Must include both keyboard and mouse rows.
    expect(pane.querySelector('.shortcuts-list kbd')).not.toBeNull();
    expect(pane.querySelector('.shortcuts-list .shortcuts-mouse')).not.toBeNull();
    // The shortcuts list lives in the "Keyboard & mouse" section. The old
    // "Camera & Interaction" section was removed — its only remaining
    // tunables (BASE_DURATION_MS, EASING_POWER) are dev-only now.
    const sectionLabels = Array.from(
      pane.querySelectorAll<HTMLElement>('.controls-section-summary .text-label')
    ).map((el) => el.textContent);
    expect(sectionLabels).toContain('Keyboard & mouse');
    expect(sectionLabels).not.toContain('Camera & Interaction');
    expect(sectionLabels).not.toContain('View');
  });

  it('renders three buttons in the sticky action bar: Reset all, Discard, Save', () => {
    const pane = mount();
    const buttons = pane.querySelectorAll<HTMLButtonElement>('.controls-actions .controls-button');
    expect(buttons.length).toBe(3);
    const labels = Array.from(buttons).map((b) => b.textContent?.trim());
    expect(labels).toContain('Reset all');
    expect(labels).toContain('Discard');
    expect(labels).toContain('Save');
    // No "Rebuild" surface anywhere — every config hot-reloads (after Save).
    expect(pane.textContent).not.toContain('Rebuild');
  });

  it('Save and Discard buttons are disabled when no drafts are pending', () => {
    const pane = mount();
    const buttons = Array.from(
      pane.querySelectorAll<HTMLButtonElement>('.controls-actions .controls-button')
    );
    const save = buttons.find((b) => b.textContent?.trim() === 'Save')!;
    const discard = buttons.find((b) => b.textContent?.trim() === 'Discard')!;
    expect(save.disabled).toBe(true);
    expect(discard.disabled).toBe(true);
  });

  it('does not render any rebuild badges on rows', () => {
    const pane = mount();
    expect(pane.querySelector('.theme-row-rebuild-badge')).toBeNull();
  });

  it('collapsed=true closes all <details> elements', async () => {
    // Collapse is declarative: render with collapsed=false, open every
    // <details>, then re-render the same container with collapsed=true —
    // the useEffect([collapsed]) closes every section.
    const pane = mount({ collapsed: false });
    // Open every details element.
    pane.querySelectorAll<HTMLDetailsElement>('details').forEach((d) => {
      d.open = true;
    });
    // Re-render into the same container with collapsed=true so the effect fires.
    act(() => {
      render(
        <ControlsPane
          onClose={() => {}}
          onRunCollisionCheck={() => {}}
          onRunStemDiagnostic={() => {}}
          collapsed={true}
        />,
        container
      );
    });
    await flush();
    const openDetails = Array.from(
      container.querySelectorAll<HTMLDetailsElement>('details')
    ).filter((d) => d.open);
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

  // Persisted-signal registration happens at module load when settings/index
  // is imported (top of file), so per-row reset buttons start correctly
  // enabled/disabled vs defaults without an explicit setup hook.

  it('renders a draft-driven group reset for collapsible subgroups that have fields', () => {
    const pane = mount();
    const subgroups = pane.querySelectorAll('details.theme-subgroup-collapsible');
    const resetBtns = pane.querySelectorAll('.controls-subgroup-reset');
    expect(subgroups.length).toBeGreaterThan(0);
    expect(resetBtns.length).toBeGreaterThan(0);
    // Field-less subgroups (e.g. the Shortcuts "General" list) render NO reset
    // button at all — not a hidden one — so there are fewer buttons than groups.
    expect(resetBtns.length).toBeLessThan(subgroups.length);
  });

  it('group reset buttons are disabled when nothing differs from default', () => {
    const pane = mount();
    const resetBtns = pane.querySelectorAll<HTMLButtonElement>('.controls-subgroup-reset');
    expect(resetBtns.length).toBeGreaterThan(0);
    // No drafts staged → no field differs from default → every group reset is
    // disabled (computed from the draft layer, not the DOM).
    for (const b of resetBtns) expect(b.disabled).toBe(true);
  });
});
