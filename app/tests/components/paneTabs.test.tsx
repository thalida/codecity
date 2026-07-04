import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { PaneTabs } from '@/components/PaneTabs/PaneTabs';
import { flush } from '../_helpers/preact';

describe('PaneTabs', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    container.remove();
  });

  const tabs = [
    { id: 'world', label: 'World' },
    { id: 'readme', label: 'Readme' },
  ];

  const tabByLabel = (label: string) =>
    Array.from(container.querySelectorAll('[role="tab"]')).find(
      (el) => el.textContent === label
    ) as HTMLButtonElement;

  it('renders a tab per entry and marks the active one', async () => {
    render(<PaneTabs tabs={tabs} active="world" onSelect={() => {}} />, container);
    await flush();
    expect(tabByLabel('World').getAttribute('aria-selected')).toBe('true');
    expect(tabByLabel('Readme').getAttribute('aria-selected')).toBe('false');
    // Regression: .pane-tabs has overflow-x: auto, which forces overflow-y to
    // auto too (CSS Overflow spec), turning it into a scrollport that can clip
    // a default-offset focus ring. `focus-inset` draws the ring inside the tab's
    // border box so the scrollport can never clip it.
    expect(tabByLabel('World').classList.contains('focus-inset')).toBe(true);
    expect(tabByLabel('Readme').classList.contains('focus-inset')).toBe(true);
  });

  it('calls onSelect with the clicked tab id', async () => {
    const onSelect = vi.fn();
    render(<PaneTabs tabs={tabs} active="world" onSelect={onSelect} />, container);
    await flush();
    tabByLabel('Readme').click();
    expect(onSelect).toHaveBeenCalledWith('readme');
  });
});
