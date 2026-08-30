import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { DebugMenu } from '@/features/city/components/DebugMenu/DebugMenu';
import { DEBUG_OPEN, openDebug } from '@/features/city/state/modals';
import { flush, drainAsync } from '../_helpers/preact';
import { popoverPanel } from '../_helpers/popover';

// Open state lives in DEBUG_OPEN rather than the popover, so external opens and
// OVERLAY_OPEN both still work.

let container: HTMLDivElement;
let onRunCollisionCheck: () => void;
let onRunStemDiagnostic: () => void;

const panel = popoverPanel;
const button = (label: string) =>
  Array.from(panel()!.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === label
  ) as HTMLButtonElement;

beforeEach(() => {
  DEBUG_OPEN.value = false;
  onRunCollisionCheck = vi.fn();
  onRunStemDiagnostic = vi.fn();
  container = document.createElement('div');
  document.body.appendChild(container);
  render(
    <DebugMenu
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

describe('DebugMenu', () => {
  it('starts closed, showing only its trigger', () => {
    expect(panel()).toBeNull();
    expect(container.querySelector('.popover-trigger')).not.toBeNull();
  });

  it('opens on openDebug(), showing both action buttons', async () => {
    openDebug();
    await flush();
    expect(panel()).not.toBeNull();
    // Non-modal: the city keeps working underneath, unlike the modal this
    // replaced.
    expect(panel()!.getAttribute('aria-modal')).toBeNull();
    const labels = Array.from(panel()!.querySelectorAll('button')).map((b) =>
      b.textContent?.trim()
    );
    expect(labels).toContain('Run collision check');
    expect(labels).toContain('Diagnose stem placement');
  });

  it('opens from its own trigger too', async () => {
    act(() => container.querySelector<HTMLButtonElement>('.popover-trigger')!.click());
    await flush();
    expect(panel()).not.toBeNull();
    expect(DEBUG_OPEN.value).toBe(true);
  });

  it('clicking "Run collision check" invokes the passed callback', async () => {
    openDebug();
    await flush();
    act(() => button('Run collision check').click());
    expect(onRunCollisionCheck).toHaveBeenCalledTimes(1);
    expect(onRunStemDiagnostic).not.toHaveBeenCalled();
  });

  it('clicking "Diagnose stem placement" invokes the passed callback', async () => {
    openDebug();
    await flush();
    act(() => button('Diagnose stem placement').click());
    expect(onRunStemDiagnostic).toHaveBeenCalledTimes(1);
    expect(onRunCollisionCheck).not.toHaveBeenCalled();
  });

  it('omits a button whose callback is not provided', async () => {
    render(<DebugMenu onRunCollisionCheck={onRunCollisionCheck} />, container);
    openDebug();
    await flush();
    const labels = Array.from(panel()!.querySelectorAll('button')).map((b) =>
      b.textContent?.trim()
    );
    expect(labels).toContain('Run collision check');
    expect(labels).not.toContain('Diagnose stem placement');
  });

  it('closes on Escape', async () => {
    openDebug();
    await flush();
    // The dismiss listeners attach via a useEffect, which Preact schedules
    // through rAF/setTimeout (up to ~35ms), not a microtask.
    await drainAsync(3, 40);
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    await flush();
    expect(panel()).toBeNull();
    expect(DEBUG_OPEN.value).toBe(false);
  });

  it('closes on a press outside, and stays open for one inside', async () => {
    openDebug();
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
