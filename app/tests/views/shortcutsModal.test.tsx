import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { ShortcutsModal } from '@/views/ShortcutsModal/ShortcutsModal';
import { SHORTCUTS_OPEN, openShortcuts, closeShortcuts } from '@/state/stores/ui';
import { flush, drainAsync } from '../_helpers/preact';

// Signal-driven like LoadingOverlay: App mounts a single <ShortcutsModal />
// unconditionally; it reads SHORTCUTS_OPEN directly and self-hides.

let container: HTMLDivElement;

beforeEach(() => {
  SHORTCUTS_OPEN.value = false;
  container = document.createElement('div');
  document.body.appendChild(container);
  render(<ShortcutsModal />, container);
});

afterEach(() => {
  render(null, container);
  container.remove();
  SHORTCUTS_OPEN.value = false;
});

describe('ShortcutsModal', () => {
  it('starts hidden (renders nothing)', () => {
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('opens on openShortcuts(), showing the dialog and the shortcuts list', async () => {
    openShortcuts();
    await flush();
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog!.getAttribute('aria-modal')).toBe('true');
    expect(container.querySelector('.shortcuts-list')).not.toBeNull();
    expect(container.querySelector('kbd')).not.toBeNull();
    expect(container.querySelector('.shortcuts-mouse')).not.toBeNull();
  });

  it('closes on close-button click', async () => {
    openShortcuts();
    await flush();
    const closeBtn = container.querySelector('[data-action="close"]') as HTMLButtonElement;
    expect(closeBtn).not.toBeNull();
    act(() => closeBtn.click());
    await flush();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('closes on Escape', async () => {
    openShortcuts();
    await flush();
    // The Esc listener attaches via a useEffect, which Preact schedules
    // through rAF/setTimeout (up to ~35ms), not a microtask — flush() alone
    // doesn't guarantee it has registered yet. Drain long enough to clear
    // that window before dispatching the key.
    await drainAsync(3, 40);
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    await flush();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('closes on backdrop click', async () => {
    openShortcuts();
    await flush();
    const backdrop = container.querySelector('.modal-backdrop') as HTMLElement;
    expect(backdrop).not.toBeNull();
    act(() => {
      backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('does not close on click inside the dialog card', async () => {
    openShortcuts();
    await flush();
    const card = container.querySelector('.modal-card') as HTMLElement;
    act(() => {
      card.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    closeShortcuts();
  });
});
