import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { ShortcutsMenu } from '@/components/menus/ShortcutsMenu/ShortcutsMenu';
import { SHORTCUTS_OPEN, openShortcuts } from '@/state/stores/chrome';
import { flush, drainAsync } from '../_helpers/preact';

// The footer mounts one <ShortcutsMenu />; its open state is SHORTCUTS_OPEN, so
// the "?" key still reaches it now that it is a popover rather than a modal.

let container: HTMLDivElement;

const panel = () => container.querySelector('[role="dialog"]');

beforeEach(() => {
  SHORTCUTS_OPEN.value = false;
  container = document.createElement('div');
  document.body.appendChild(container);
  render(<ShortcutsMenu />, container);
});

afterEach(() => {
  render(null, container);
  container.remove();
  SHORTCUTS_OPEN.value = false;
});

describe('ShortcutsMenu', () => {
  it('starts closed, showing only its trigger', () => {
    expect(panel()).toBeNull();
    expect(container.querySelector('.popover-trigger')).not.toBeNull();
  });

  it('opens on openShortcuts(), showing both reference lists', async () => {
    openShortcuts();
    await flush();
    expect(panel()).not.toBeNull();
    // Non-modal: the city stays interactive behind it.
    expect(panel()!.getAttribute('aria-modal')).toBeNull();
    // Keyboard + Mouse. jsdom reports a fine pointer, so Touch is absent here.
    expect(container.querySelectorAll('.shortcuts-list')).toHaveLength(2);
    expect(container.querySelector('kbd')).not.toBeNull();
    expect(container.querySelector('.shortcuts-gesture')).not.toBeNull();
  });

  it('opens from its own trigger too', async () => {
    act(() => container.querySelector<HTMLButtonElement>('.popover-trigger')!.click());
    await flush();
    expect(panel()).not.toBeNull();
    expect(SHORTCUTS_OPEN.value).toBe(true);
  });

  it('closes on Escape, and clears the shared signal so "?" can reopen it', async () => {
    openShortcuts();
    await flush();
    // The dismiss listeners attach via a useEffect, which Preact schedules
    // through rAF/setTimeout (up to ~35ms), not a microtask.
    await drainAsync(3, 40);
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    await flush();
    expect(panel()).toBeNull();
    expect(SHORTCUTS_OPEN.value).toBe(false);
  });

  it('closes on a press outside, and stays open for one inside', async () => {
    openShortcuts();
    await flush();
    await drainAsync(3, 40);

    act(() => {
      panel()!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    await flush();
    expect(panel()).not.toBeNull();

    act(() => {
      document.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    await flush();
    expect(panel()).toBeNull();
  });
});
