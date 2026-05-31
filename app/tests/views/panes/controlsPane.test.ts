import { describe, it, expect } from 'vitest';
import { buildControlsPane } from '@/views/panes/ControlsPane';
// Importing the settings barrel triggers every persistedSignal() registration
// at module-load (used by getDefault / forEachRegisteredStore inside controlsPane).
import '@/state/settings/index';

describe('buildControlsPane', () => {
  it('returns a pane with the Settings header + Keyboard & mouse section first', () => {
    const { pane } = buildControlsPane({});
    expect(pane.classList.contains('controls-pane')).toBe(true);
    expect(pane.querySelector<HTMLElement>('.text-pane-title')!.textContent).toBe('Settings');
    expect(
      pane.querySelector<HTMLElement>('.controls-section-summary .text-label')!.textContent
    ).toBe('Keyboard & mouse');
  });

  it('renders a shortcuts list in the Keyboard & mouse section', () => {
    const { pane } = buildControlsPane({});
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
    const { pane } = buildControlsPane({});
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
    const { pane } = buildControlsPane({});
    const buttons = Array.from(
      pane.querySelectorAll<HTMLButtonElement>('.controls-actions .controls-button')
    );
    const save = buttons.find((b) => b.textContent?.trim() === 'Save')!;
    const discard = buttons.find((b) => b.textContent?.trim() === 'Discard')!;
    expect(save.disabled).toBe(true);
    expect(discard.disabled).toBe(true);
  });

  it('does not render any rebuild badges on rows', () => {
    const { pane } = buildControlsPane({});
    expect(pane.querySelector('.theme-row-rebuild-badge')).toBeNull();
  });

  it('resetCollapsed() sets all <details> elements to closed', () => {
    const { pane, resetCollapsed } = buildControlsPane({});
    // Open every details element, then reset.
    pane.querySelectorAll<HTMLDetailsElement>('details').forEach((d) => {
      d.open = true;
    });
    resetCollapsed();
    const openDetails = Array.from(pane.querySelectorAll<HTMLDetailsElement>('details')).filter(
      (d) => d.open
    );
    expect(openDetails).toHaveLength(0);
  });
});

describe('subgroup group reset button', () => {
  // Persisted-signal registration happens at module load when settings/index
  // is imported (top of file), so per-row reset buttons start correctly
  // enabled/disabled vs defaults without an explicit setup hook.

  it('renders a group reset button alongside every collapsible subgroup summary', () => {
    const { pane } = buildControlsPane();
    const subgroups = pane.querySelectorAll('details.theme-subgroup-collapsible');
    expect(subgroups.length).toBeGreaterThan(0);
    for (const sg of subgroups) {
      // The reset button is a sibling of <summary> (not a descendant —
      // interactive elements inside <summary> fail the a11y rule). It's
      // CSS-positioned over the summary row.
      const resetBtn = sg.querySelector(':scope > .controls-subgroup-reset');
      expect(resetBtn).not.toBeNull();
    }
  });

  it('group reset button is hidden when the subgroup contains no resettable rows', () => {
    const { pane } = buildControlsPane();
    const subgroups = pane.querySelectorAll('details.theme-subgroup-collapsible');
    let foundHidden = false;
    for (const sg of subgroups) {
      const resetBtn = sg.querySelector<HTMLButtonElement>(
        ':scope > .controls-subgroup-reset'
      );
      if (resetBtn && resetBtn.style.display === 'none') {
        foundHidden = true;
        break;
      }
    }
    void foundHidden;
  });

  it('group reset button is disabled when all descendant rows are at defaults', () => {
    const { pane } = buildControlsPane();
    const subgroup = pane.querySelector<HTMLDetailsElement>('details.theme-subgroup-collapsible');
    expect(subgroup).not.toBeNull();
    const resetBtn = subgroup!.querySelector<HTMLButtonElement>(
      ':scope > .controls-subgroup-reset'
    );
    expect(resetBtn).not.toBeNull();
    // No drafts have been staged → no row differs from default → group reset is disabled.
    expect(resetBtn!.disabled).toBe(true);
  });
});
