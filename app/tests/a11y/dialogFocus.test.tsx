import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { DebugModal } from '@/views/DebugModal/DebugModal';
import { openDebug, closeDebug, DEBUG_OPEN } from '@/state/stores/ui';

// A background sibling of the modal root, so we can assert it gets inerted.
function Wrapper() {
  return (
    <>
      <div id="bg">
        <button id="bgbtn">background</button>
      </div>
      <DebugModal onRunCollisionCheck={() => {}} onRunStemDiagnostic={() => {}} />
    </>
  );
}

describe('useDialogFocus (via DebugModal)', () => {
  let container: HTMLDivElement;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });
  afterEach(() => {
    closeDebug();
    render(null, container);
    container.remove();
  });

  it('moves focus into the dialog and inerts the background when open', () => {
    openDebug();
    act(() => render(<Wrapper />, container));
    const closeBtn = container.querySelector<HTMLElement>('[data-action="close"]');
    expect(document.activeElement).toBe(closeBtn);
    expect((container.querySelector('#bg') as HTMLElement).inert).toBe(true);
  });

  it('un-inerts the background when closed', () => {
    openDebug();
    act(() => render(<Wrapper />, container));
    expect((container.querySelector('#bg') as HTMLElement).inert).toBe(true);
    act(() => {
      DEBUG_OPEN.value = false;
    });
    expect((container.querySelector('#bg') as HTMLElement).inert).toBe(false);
  });

  it('traps Tab: wraps from last focusable back to the first', () => {
    openDebug();
    act(() => render(<Wrapper />, container));
    const focusables = Array.from(container.querySelectorAll<HTMLElement>('.modal-card button'));
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    expect(focusables.length).toBeGreaterThan(1);
    last.focus();
    last.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(document.activeElement).toBe(first);
  });
});
