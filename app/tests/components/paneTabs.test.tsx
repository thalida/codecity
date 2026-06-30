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
    render(
      <PaneTabs idPrefix="info-pane" tabs={tabs} active="world" onSelect={() => {}} />,
      container
    );
    await flush();
    const world = tabByLabel('World');
    const readme = tabByLabel('Readme');
    expect(world.getAttribute('aria-selected')).toBe('true');
    expect(world.getAttribute('aria-controls')).toBe('info-pane-world-panel');
    expect(world.id).toBe('info-pane-world-tab');
    expect(world.tabIndex).toBe(0);
    expect(readme.getAttribute('aria-selected')).toBe('false');
    expect(readme.tabIndex).toBe(-1);
  });

  it('calls onSelect with the clicked tab id', async () => {
    const onSelect = vi.fn();
    render(<PaneTabs tabs={tabs} active="world" onSelect={onSelect} />, container);
    await flush();
    tabByLabel('Readme').click();
    expect(onSelect).toHaveBeenCalledWith('readme');
  });

  it('moves selection with tablist keyboard shortcuts', async () => {
    const onSelect = vi.fn();
    render(<PaneTabs tabs={tabs} active="world" onSelect={onSelect} />, container);
    await flush();

    tabByLabel('World').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(onSelect).toHaveBeenLastCalledWith('readme');

    tabByLabel('World').dispatchEvent(new KeyboardEvent('keydown', { key: 'End' }));
    expect(onSelect).toHaveBeenLastCalledWith('readme');

    tabByLabel('Readme').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    expect(onSelect).toHaveBeenLastCalledWith('world');
  });
});
