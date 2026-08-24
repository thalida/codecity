// hooks/useDismissable.ts — the three ways a non-modal popover closes on its
// own: a press outside, focus landing outside, Escape. `parts`, not one root:
// the panel portals out of the trigger's tree, so both subtrees count as inside.
// `refocus` is false for pointer dismissals only, which already moved focus.

import { useEffect } from 'preact/hooks';
import type { RefObject } from 'preact';

export function useDismissable(
  open: boolean,
  parts: RefObject<HTMLElement>[],
  onDismiss: (refocus: boolean) => void
): void {
  useEffect(() => {
    if (!open) return;

    const outside = (node: Node | null) => !parts.some((p) => p.current?.contains(node));

    function onPointerDown(e: PointerEvent) {
      if (outside(e.target as Node)) onDismiss(false);
    }
    function onFocusIn(e: FocusEvent) {
      if (outside(e.target as Node)) onDismiss(true);
    }
    // On the document, not the panel: the trigger holds focus until the user
    // tabs in, and Escape has to work from there too.
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      onDismiss(true);
    }

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('keydown', onKeyDown);
    };
    // `parts` omitted: rebuilt every render, but the refs in it are stable and
    // `.current` is read at event time.
  }, [open, onDismiss]);
}
