// hooks/useDialogFocus.ts — Focus management for a modal dialog. While open it
// moves focus into the dialog, traps Tab inside it, marks every sibling of the
// dialog root inert (so background content leaves the tab order and the
// accessibility tree), and restores focus to the previously focused element on
// close. `rootRef` points at the OUTERMOST modal element (its siblings — the
// header/main/footer and any other overlays — are the ones inerted).

import { useEffect } from 'preact/hooks';
import type { RefObject } from 'preact';

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function useDialogFocus(isOpen: boolean, rootRef: RefObject<HTMLElement>): void {
  useEffect(() => {
    if (!isOpen) return;
    const root = rootRef.current;
    if (!root) return;

    const prevFocus = document.activeElement as HTMLElement | null;

    const siblings = root.parentElement
      ? (Array.from(root.parentElement.children) as HTMLElement[]).filter((el) => el !== root)
      : [];
    for (const el of siblings) el.inert = true;

    const focusables = () => Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
    const first = focusables()[0];
    if (first) first.focus();
    else {
      root.tabIndex = -1;
      root.focus();
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };
    root.addEventListener('keydown', onKeyDown);

    return () => {
      root.removeEventListener('keydown', onKeyDown);
      for (const el of siblings) el.inert = false;
      prevFocus?.focus?.();
    };
  }, [isOpen]);
}
