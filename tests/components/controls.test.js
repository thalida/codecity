import { describe, it, expect } from 'vitest';
import { buildControlsPane } from '../../src/components/controls.js';

describe('buildControlsPane', () => {
  it('returns a pane with the Controls header + View section', () => {
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

  it('renders a Rebuild button in the sticky action bar', () => {
    const pane = buildControlsPane({});
    const rebuildBtn = pane.querySelector('.controls-actions .controls-button');
    expect(rebuildBtn).not.toBeNull();
    expect(rebuildBtn.textContent).toBe('Rebuild');
  });
});
