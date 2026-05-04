import { describe, it, expect } from 'vitest';
import { buildControlsPane } from '../../../views/panes/controlsPane.js';

describe('buildControlsPane', () => {
  it('returns a pane with the Controls header + View section first', () => {
    const pane = buildControlsPane({});
    expect(pane.classList.contains('controls-pane')).toBe(true);
    expect(pane.querySelector('.controls-title').textContent).toBe('Controls');
    expect(pane.querySelector('.controls-section-label').textContent).toBe('View');
  });

  it('renders a shortcuts list in the View section (no Reset camera button)', () => {
    const pane = buildControlsPane({});
    const shortcuts = pane.querySelector('.shortcuts-list');
    expect(shortcuts).not.toBeNull();
    // Must include both keyboard and mouse rows.
    expect(pane.querySelector('.shortcuts-list kbd')).not.toBeNull();
    expect(pane.querySelector('.shortcuts-list .shortcuts-mouse')).not.toBeNull();
  });

  it('renders a Reset-all button in the sticky action bar (no Rebuild)', () => {
    const pane = buildControlsPane({});
    const buttons = pane.querySelectorAll('.controls-actions .controls-button');
    expect(buttons.length).toBe(1);
    expect(buttons[0].textContent).toBe('Reset all');
    // No "Rebuild" surface anywhere — every config hot-reloads.
    expect(pane.textContent).not.toContain('Rebuild');
  });

  it('does not render any rebuild badges on rows', () => {
    const pane = buildControlsPane({});
    expect(pane.querySelector('.theme-row-rebuild-badge')).toBeNull();
  });
});
