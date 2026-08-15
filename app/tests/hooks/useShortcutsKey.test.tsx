import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { useShortcutsKey } from '@/hooks/useShortcutsKey';
import { SHORTCUTS_OPEN, closeShortcuts } from '@/state/stores/ui';
import { navigate } from '@/router/location';
import { ROUTES } from '@/router/paths';
import { drainAsync } from '../_helpers/preact';

function Harness() {
  useShortcutsKey();
  return null;
}

describe('useShortcutsKey', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    // Over a city: home IS the switcher, and a modal owns the keyboard there.
    navigate(ROUTES.CITY, { replace: true });
    closeShortcuts();
  });

  afterEach(() => {
    render(null, container);
    container.remove();
    closeShortcuts();
    navigate(ROUTES.HOME, { replace: true });
  });

  const press = (target: EventTarget = document) =>
    target.dispatchEvent(new window.KeyboardEvent('keydown', { key: '?', bubbles: true }));

  it('opens the shortcuts panel', async () => {
    render(<Harness />, container);
    await drainAsync(3, 20);
    press();
    expect(SHORTCUTS_OPEN.value).toBe(true);
  });

  // "?" is a character people type. A repo URL or a search box has to keep it.
  it('does nothing while an input has focus', async () => {
    const input = document.createElement('input');
    container.appendChild(input);
    render(<Harness />, container);
    await drainAsync(3, 20);
    press(input);
    expect(SHORTCUTS_OPEN.value).toBe(false);
  });

  it('does nothing while a textarea has focus', async () => {
    const area = document.createElement('textarea');
    container.appendChild(area);
    render(<Harness />, container);
    await drainAsync(3, 20);
    press(area);
    expect(SHORTCUTS_OPEN.value).toBe(false);
  });

  it('does nothing in a contenteditable', async () => {
    const box = document.createElement('div');
    // setAttribute, not .contentEditable: jsdom's property setter doesn't
    // reflect to the attribute, and the attribute is what markup carries.
    box.setAttribute('contenteditable', 'true');
    container.appendChild(box);
    render(<Harness />, container);
    await drainAsync(3, 20);
    press(box);
    expect(SHORTCUTS_OPEN.value).toBe(false);
  });

  it('does nothing from a node inside a contenteditable', async () => {
    // Typing in a rich-text area puts the event on whichever child holds the
    // caret, not on the editable root.
    const box = document.createElement('div');
    box.setAttribute('contenteditable', 'true');
    const inner = document.createElement('span');
    box.appendChild(inner);
    container.appendChild(box);
    render(<Harness />, container);
    await drainAsync(3, 20);
    press(inner);
    expect(SHORTCUTS_OPEN.value).toBe(false);
  });

  it('ignores other keys', async () => {
    render(<Harness />, container);
    await drainAsync(3, 20);
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'k', bubbles: true }));
    expect(SHORTCUTS_OPEN.value).toBe(false);
  });
});
