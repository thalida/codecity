import { describe, it, expect } from 'vitest';
import { buildControlsPane } from '@/views/panes/controlsPane.js';

describe('buildControlsPane', () => {
  it('returns a pane with the Controls header + View section first', () => {
    const pane = buildControlsPane({});
    expect(pane.classList.contains('controls-pane')).toBe(true);
    expect(pane.querySelector<HTMLElement>('.controls-title')!.textContent).toBe('Controls');
    expect(pane.querySelector<HTMLElement>('.controls-section-label')!.textContent).toBe('View');
  });

  it('renders a shortcuts list in the View section (no Reset camera button)', () => {
    const pane = buildControlsPane({});
    const shortcuts = pane.querySelector<HTMLElement>('.shortcuts-list');
    expect(shortcuts).not.toBeNull();
    // Must include both keyboard and mouse rows.
    expect(pane.querySelector('.shortcuts-list kbd')).not.toBeNull();
    expect(pane.querySelector('.shortcuts-list .shortcuts-mouse')).not.toBeNull();
  });

  it('renders three buttons in the sticky action bar: Reset all, Discard, Save', () => {
    const pane = buildControlsPane({});
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
    const pane = buildControlsPane({});
    const buttons = Array.from(
      pane.querySelectorAll<HTMLButtonElement>('.controls-actions .controls-button')
    );
    const save = buttons.find((b) => b.textContent?.trim() === 'Save')!;
    const discard = buttons.find((b) => b.textContent?.trim() === 'Discard')!;
    expect(save.disabled).toBe(true);
    expect(discard.disabled).toBe(true);
  });

  it('does not render any rebuild badges on rows', () => {
    const pane = buildControlsPane({});
    expect(pane.querySelector('.theme-row-rebuild-badge')).toBeNull();
  });
});
