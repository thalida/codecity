import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { useRef } from 'preact/hooks';
import { act } from 'preact/test-utils';
import { signal } from '@preact/signals';
import { useDialogFocus } from '@/hooks/useDialogFocus';

// Exercised through a minimal dialog rather than a real view: ProjectsView is
// the hook's only caller now, and mounting it would drag the whole source
// picker in to assert focus behaviour that belongs to the hook.

const OPEN = signal(false);

function Dialog() {
  const rootRef = useRef<HTMLDivElement>(null);
  const isOpen = OPEN.value;
  useDialogFocus(isOpen, rootRef);
  if (!isOpen) return null;
  return (
    <div ref={rootRef} class="test-dialog" role="dialog" aria-label="Test">
      <button id="first">first</button>
      <button id="last">last</button>
    </div>
  );
}

// A background sibling of the dialog root, so we can assert it gets inerted.
function Wrapper() {
  return (
    <>
      <div id="bg">
        <button id="bgbtn">background</button>
      </div>
      <Dialog />
    </>
  );
}

describe('useDialogFocus', () => {
  let container: HTMLDivElement;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });
  afterEach(() => {
    OPEN.value = false;
    render(null, container);
    container.remove();
  });

  it('moves focus into the dialog and inerts the background when open', () => {
    OPEN.value = true;
    act(() => render(<Wrapper />, container));
    expect(document.activeElement).toBe(container.querySelector('#first'));
    expect((container.querySelector('#bg') as HTMLElement).inert).toBe(true);
  });

  it('un-inerts the background when closed', () => {
    OPEN.value = true;
    act(() => render(<Wrapper />, container));
    expect((container.querySelector('#bg') as HTMLElement).inert).toBe(true);
    act(() => {
      OPEN.value = false;
    });
    expect((container.querySelector('#bg') as HTMLElement).inert).toBe(false);
  });

  it('traps Tab: wraps from last focusable back to the first', () => {
    OPEN.value = true;
    act(() => render(<Wrapper />, container));
    const first = container.querySelector<HTMLElement>('#first')!;
    const last = container.querySelector<HTMLElement>('#last')!;
    last.focus();
    last.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(document.activeElement).toBe(first);
  });
});
