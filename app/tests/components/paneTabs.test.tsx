import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { PaneTabs } from '@/components/panes/PaneTabs/PaneTabs';
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
    // overflow-x: auto forces overflow-y too, making a scrollport that clips an
    // offset focus ring; focus-inset draws it inside the border box.
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

  it('roving tabindex: only the active tab is a tab stop', async () => {
    render(<PaneTabs tabs={tabs} active="world" onSelect={() => {}} />, container);
    await flush();
    expect(tabByLabel('World').tabIndex).toBe(0);
    expect(tabByLabel('Readme').tabIndex).toBe(-1);
  });

  function key(el: HTMLElement, k: string) {
    el.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true }));
  }

  it('ArrowRight/Left select the next/previous tab, wrapping at the ends', async () => {
    const onSelect = vi.fn();
    render(<PaneTabs tabs={tabs} active="world" onSelect={onSelect} />, container);
    await flush();
    key(tabByLabel('World'), 'ArrowRight');
    expect(onSelect).toHaveBeenLastCalledWith('readme');
    key(tabByLabel('World'), 'ArrowLeft'); // wraps to last
    expect(onSelect).toHaveBeenLastCalledWith('readme');
  });

  it('Home/End jump to the first/last tab', async () => {
    const onSelect = vi.fn();
    render(<PaneTabs tabs={tabs} active="readme" onSelect={onSelect} />, container);
    await flush();
    key(tabByLabel('Readme'), 'Home');
    expect(onSelect).toHaveBeenLastCalledWith('world');
    key(tabByLabel('Readme'), 'End');
    expect(onSelect).toHaveBeenLastCalledWith('readme');
  });

  it('wires aria-controls + tab ids when given a panelId', async () => {
    render(<PaneTabs tabs={tabs} active="world" onSelect={() => {}} panelId="p" />, container);
    await flush();
    expect(tabByLabel('World').id).toBe('p-tab-world');
    expect(tabByLabel('World').getAttribute('aria-controls')).toBe('p');
  });
});
