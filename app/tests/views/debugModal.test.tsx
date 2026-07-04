import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { DebugModal } from '@/views/DebugModal/DebugModal';
import { DEBUG_OPEN, openDebug, closeDebug } from '@/state/stores/ui';
import { flush, drainAsync } from '../_helpers/preact';

// Signal-driven like ShortcutsModal: App mounts a single <DebugModal /> with
// the scene commands as props; it reads DEBUG_OPEN directly and self-hides.

let container: HTMLDivElement;
let onRunCollisionCheck: () => void;
let onRunStemDiagnostic: () => void;

beforeEach(() => {
  DEBUG_OPEN.value = false;
  onRunCollisionCheck = vi.fn();
  onRunStemDiagnostic = vi.fn();
  container = document.createElement('div');
  document.body.appendChild(container);
  render(
    <DebugModal
      onRunCollisionCheck={onRunCollisionCheck}
      onRunStemDiagnostic={onRunStemDiagnostic}
    />,
    container
  );
});

afterEach(() => {
  render(null, container);
  container.remove();
  DEBUG_OPEN.value = false;
});

describe('DebugModal', () => {
  it('starts hidden (renders nothing)', () => {
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('opens on openDebug(), showing the dialog and both action buttons', async () => {
    openDebug();
    await flush();
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog!.getAttribute('aria-modal')).toBe('true');
    const buttons = Array.from(container.querySelectorAll('button')).map((b) =>
      b.textContent?.trim()
    );
    expect(buttons).toContain('Run collision check');
    expect(buttons).toContain('Diagnose stem placement');
  });

  it('clicking "Run collision check" invokes the passed callback', async () => {
    openDebug();
    await flush();
    const btn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Run collision check'
    ) as HTMLButtonElement;
    act(() => btn.click());
    expect(onRunCollisionCheck).toHaveBeenCalledTimes(1);
    expect(onRunStemDiagnostic).not.toHaveBeenCalled();
  });

  it('clicking "Diagnose stem placement" invokes the passed callback', async () => {
    openDebug();
    await flush();
    const btn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Diagnose stem placement'
    ) as HTMLButtonElement;
    act(() => btn.click());
    expect(onRunStemDiagnostic).toHaveBeenCalledTimes(1);
    expect(onRunCollisionCheck).not.toHaveBeenCalled();
  });

  it('omits a button whose callback is not provided', async () => {
    render(<DebugModal onRunCollisionCheck={onRunCollisionCheck} />, container);
    openDebug();
    await flush();
    const buttons = Array.from(container.querySelectorAll('button')).map((b) =>
      b.textContent?.trim()
    );
    expect(buttons).toContain('Run collision check');
    expect(buttons).not.toContain('Diagnose stem placement');
  });

  it('closes on close-button click', async () => {
    openDebug();
    await flush();
    const closeBtn = container.querySelector('[data-action="close"]') as HTMLButtonElement;
    expect(closeBtn).not.toBeNull();
    act(() => closeBtn.click());
    await flush();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('closes on Escape', async () => {
    openDebug();
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
    openDebug();
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
    openDebug();
    await flush();
    const card = container.querySelector('.modal-card') as HTMLElement;
    act(() => {
      card.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    closeDebug();
  });
});
