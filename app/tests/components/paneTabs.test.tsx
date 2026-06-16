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
      (el) => el.textContent === label,
    ) as HTMLButtonElement;

  it('renders a tab per entry and marks the active one', async () => {
    render(<PaneTabs tabs={tabs} active="world" onSelect={() => {}} />, container);
    await flush();
    expect(tabByLabel('World').getAttribute('aria-selected')).toBe('true');
    expect(tabByLabel('Readme').getAttribute('aria-selected')).toBe('false');
  });

  it('calls onSelect with the clicked tab id', async () => {
    const onSelect = vi.fn();
    render(<PaneTabs tabs={tabs} active="world" onSelect={onSelect} />, container);
    await flush();
    tabByLabel('Readme').click();
    expect(onSelect).toHaveBeenCalledWith('readme');
  });

  it('ArrowRight moves selection to the next tab', async () => {
    const onSelect = vi.fn();
    render(<PaneTabs tabs={tabs} active="world" onSelect={onSelect} />, container);
    await flush();
    tabByLabel('World').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
    );
    expect(onSelect).toHaveBeenCalledWith('readme');
  });

  it('ArrowLeft wraps from the first tab to the last', async () => {
    const onSelect = vi.fn();
    render(<PaneTabs tabs={tabs} active="world" onSelect={onSelect} />, container);
    await flush();
    tabByLabel('World').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }),
    );
    expect(onSelect).toHaveBeenCalledWith('readme');
  });

  it('ArrowRight wraps from the last tab to the first', async () => {
    const onSelect = vi.fn();
    render(<PaneTabs tabs={tabs} active="readme" onSelect={onSelect} />, container);
    await flush();
    tabByLabel('Readme').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
    );
    expect(onSelect).toHaveBeenCalledWith('world');
  });
});
