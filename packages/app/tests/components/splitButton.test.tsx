import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { SplitButton } from '@/features/home/components/SplitButton/SplitButton';
import { drainAsync, flush } from '../_helpers/preact';

// Preact schedules useEffect on rAF, so the open effect needs a real timer
// yield rather than flush()'s microtask hop.
const settleEffects = () => drainAsync(3, 20);

describe('SplitButton', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    container.remove();
  });

  const items = [
    {
      id: 'fresh',
      label: 'Open with a fresh scan',
      sublabel: 'ignore the cache',
      onSelect: vi.fn(),
    },
    { id: 'other', label: 'Something else', onSelect: vi.fn() },
  ];

  const caret = () => container.querySelector('.split-button-caret') as HTMLButtonElement;
  const primary = () => container.querySelector('.split-button-primary') as HTMLButtonElement;
  const menu = () => container.querySelector('[role="menu"]');
  const menuItems = () => Array.from(container.querySelectorAll<HTMLElement>('[role="menuitem"]'));

  function mount(props: Partial<Parameters<typeof SplitButton>[0]> = {}) {
    render(
      <SplitButton
        label="Open"
        onPrimary={() => {}}
        items={items}
        menuLabel="More open options"
        {...props}
      />,
      container
    );
  }

  function key(el: HTMLElement, k: string) {
    el.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true }));
  }

  it('runs the primary action without opening the menu', async () => {
    const onPrimary = vi.fn();
    mount({ onPrimary });
    await flush();
    primary().click();
    expect(onPrimary).toHaveBeenCalledTimes(1);
    expect(menu()).toBeNull();
  });

  it('starts closed and reports that on the caret', async () => {
    mount();
    await flush();
    expect(menu()).toBeNull();
    expect(caret().getAttribute('aria-haspopup')).toBe('menu');
    expect(caret().getAttribute('aria-expanded')).toBe('false');
  });

  it('opens on the caret and marks itself expanded', async () => {
    mount();
    await flush();
    caret().click();
    await flush();
    expect(menu()).not.toBeNull();
    expect(caret().getAttribute('aria-expanded')).toBe('true');
    expect(menuItems().map((el) => el.textContent)).toEqual([
      'Open with a fresh scanignore the cache',
      'Something else',
    ]);
  });

  it('focuses the first item on open, so the keyboard continues from the menu', async () => {
    mount();
    await flush();
    caret().click();
    await settleEffects();
    expect(document.activeElement).toBe(menuItems()[0]);
  });

  it('selecting an item runs it and closes', async () => {
    const onSelect = vi.fn();
    mount({ items: [{ id: 'a', label: 'A', onSelect }] });
    await flush();
    caret().click();
    await flush();
    menuItems()[0].click();
    await flush();
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(menu()).toBeNull();
  });

  it('Escape closes and returns focus to the caret', async () => {
    mount();
    await flush();
    caret().click();
    await settleEffects();
    key(menuItems()[0], 'Escape');
    await flush();
    expect(menu()).toBeNull();
    // Focus must come back: the item it was on has just been removed, and
    // leaving focus on a detached node drops the user at the top of the page.
    expect(document.activeElement).toBe(caret());
  });

  it('Down and Up move between items and wrap', async () => {
    mount();
    await flush();
    caret().click();
    await settleEffects();
    key(menuItems()[0], 'ArrowDown');
    expect(document.activeElement).toBe(menuItems()[1]);
    key(menuItems()[1], 'ArrowDown');
    expect(document.activeElement).toBe(menuItems()[0]);
    key(menuItems()[0], 'ArrowUp');
    expect(document.activeElement).toBe(menuItems()[1]);
  });

  it('Home and End jump to the ends', async () => {
    mount();
    await flush();
    caret().click();
    await settleEffects();
    key(menuItems()[0], 'End');
    expect(document.activeElement).toBe(menuItems()[1]);
    key(menuItems()[1], 'Home');
    expect(document.activeElement).toBe(menuItems()[0]);
  });

  it('Down on a closed caret opens the menu', async () => {
    mount();
    await flush();
    caret().focus();
    key(caret(), 'ArrowDown');
    await flush();
    expect(menu()).not.toBeNull();
  });

  it('a pointer press outside closes it', async () => {
    mount();
    await flush();
    caret().click();
    await settleEffects();
    document.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
    await flush();
    expect(menu()).toBeNull();
  });

  it('focus moving outside closes it, so tabbing away cannot strand it open', async () => {
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    mount();
    await flush();
    caret().click();
    await settleEffects();
    outside.dispatchEvent(new window.FocusEvent('focusin', { bubbles: true }));
    await flush();
    expect(menu()).toBeNull();
    outside.remove();
  });

  it('disables both halves together', async () => {
    mount({ disabled: true });
    await flush();
    expect(primary().disabled).toBe(true);
    expect(caret().disabled).toBe(true);
  });

  it('can submit a real form, so Enter in a field and a click agree', async () => {
    const onSubmit = vi.fn((e: Event) => e.preventDefault());
    const form = document.createElement('form');
    form.addEventListener('submit', onSubmit);
    container.appendChild(form);
    render(
      <SplitButton
        label="Open"
        onPrimary={() => {}}
        items={items}
        menuLabel="More open options"
        primaryType="submit"
      />,
      form
    );
    await flush();
    expect((form.querySelector('.split-button-primary') as HTMLButtonElement).type).toBe('submit');
    // The caret must never submit: it opens a menu.
    expect((form.querySelector('.split-button-caret') as HTMLButtonElement).type).toBe('button');
    render(null, form);
  });
});
