import { describe, it, expect, vi } from 'vitest';
import { buildControlsPane } from '../../src/components/controls.js';

describe('buildControlsPane', () => {
  it('returns a pane with the Controls header + View section', () => {
    const pane = buildControlsPane({});
    expect(pane.classList.contains('controls-pane')).toBe(true);
    expect(pane.querySelector('.controls-title').textContent).toBe('Controls');
    expect(pane.querySelector('.controls-section-label').textContent).toBe('View');
  });

  it('renders a Reset View button that fires onResetView', () => {
    const handler = vi.fn();
    const pane = buildControlsPane({ onResetView: handler });
    const resetBtn = pane.querySelector('.controls-button');
    expect(resetBtn).not.toBeNull();
    expect(resetBtn.textContent).toBe('Reset View');
    resetBtn.click();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('does nothing if onResetView is omitted', () => {
    const pane = buildControlsPane({});
    const resetBtn = pane.querySelector('.controls-button');
    expect(() => resetBtn.click()).not.toThrow();
  });
});
