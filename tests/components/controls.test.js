import { describe, it, expect, vi } from 'vitest';
import { buildControlsPane } from '../../src/components/controls.js';

describe('buildControlsPane', () => {
  it('returns a pane with header + Height section', () => {
    const pane = buildControlsPane({ initialHeightMode: 'compact' });
    expect(pane.classList.contains('controls-pane')).toBe(true);
    expect(pane.querySelector('.controls-title').textContent).toBe('Controls');
    expect(pane.querySelector('.controls-section-label').textContent).toBe('Height');
  });

  it('marks the initial mode as active in the segmented control', () => {
    const pane = buildControlsPane({ initialHeightMode: 'exact' });
    const active = pane.querySelector('.segmented-option.active');
    expect(active.dataset.value).toBe('exact');
  });

  it('defaults to compact when no initial mode is provided', () => {
    const pane = buildControlsPane({});
    const active = pane.querySelector('.segmented-option.active');
    expect(active.dataset.value).toBe('compact');
  });

  it('fires onHeightModeChange when a different mode is clicked', () => {
    const handler = vi.fn();
    const pane = buildControlsPane({
      initialHeightMode: 'compact',
      onHeightModeChange: handler
    });
    const exactBtn = pane.querySelector('.segmented-option[data-value="exact"]');
    exactBtn.click();
    expect(handler).toHaveBeenCalledWith('exact');
    expect(exactBtn.classList.contains('active')).toBe(true);
  });

  it('does not fire when the active mode is re-clicked', () => {
    const handler = vi.fn();
    const pane = buildControlsPane({
      initialHeightMode: 'compact',
      onHeightModeChange: handler
    });
    const compactBtn = pane.querySelector('.segmented-option[data-value="compact"]');
    compactBtn.click();
    expect(handler).not.toHaveBeenCalled();
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
});
