// components/SplitButton/SplitButton.tsx — a primary action plus a caret that
// opens a menu of variants on the same action. Used where a control has one
// obvious default and a rarer "same thing, but harder" sibling: Open / Open
// with a fresh scan, Refresh / Fresh scan.
//
// The default stays one press. A variant costs two, which is the point: it
// reads as a modifier on the action rather than a competing button.

import './SplitButton.css';
import { useEffect, useRef, useState } from 'preact/hooks';
import { ChevronDown } from 'lucide-preact';
import type { ComponentChildren } from 'preact';

export interface SplitButtonItem {
  id: string;
  label: string;
  /** One line under the label saying what it does differently. */
  sublabel?: string;
  onSelect: () => void;
}

export interface SplitButtonProps {
  label: string;
  onPrimary: () => void;
  items: SplitButtonItem[];
  disabled?: boolean;
  /** `submit` lets the primary half drive a real <form>, so Enter in a field
   *  and a click on the button take the same path. */
  primaryType?: 'button' | 'submit';
  /** Accessible name for the caret, e.g. "More open options". */
  menuLabel: string;
  /** Extra class on the root, for context-specific sizing. */
  class?: string;
  /** Rendered under the items, inside the menu. For a control that belongs
   *  with the menu but isn't one of its actions (the auto-refresh row). */
  footer?: ComponentChildren;
}

export function SplitButton({
  label,
  onPrimary,
  items,
  disabled,
  primaryType = 'button',
  menuLabel,
  class: className,
  footer,
}: SplitButtonProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const caret = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  // Closing always returns focus to the caret: the menu's items are gone, so
  // leaving focus on a removed node would drop the user at the top of the page.
  function close(refocus = true) {
    setOpen(false);
    if (refocus) caret.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    // Focus the first item on open so the keyboard path continues where the
    // eye already is, rather than starting from the caret again.
    const first = menu.current?.querySelector<HTMLElement>('[role="menuitem"]');
    first?.focus();

    function onPointerDown(e: PointerEvent) {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    }
    // Anything that moves the page out from under an open menu should close it.
    function onFocusIn(e: FocusEvent) {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('focusin', onFocusIn);
    };
  }, [open]);

  function onMenuKeyDown(e: KeyboardEvent) {
    const focusable = Array.from(
      menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []
    );
    const idx = focusable.indexOf(document.activeElement as HTMLElement);
    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        close();
        return;
      case 'ArrowDown':
        e.preventDefault();
        focusable[(idx + 1) % focusable.length]?.focus();
        return;
      case 'ArrowUp':
        e.preventDefault();
        focusable[(idx - 1 + focusable.length) % focusable.length]?.focus();
        return;
      case 'Home':
        e.preventDefault();
        focusable[0]?.focus();
        return;
      case 'End':
        e.preventDefault();
        focusable[focusable.length - 1]?.focus();
        return;
      default:
        return;
    }
  }

  return (
    <div class={className ? `split-button ${className}` : 'split-button'} ref={root}>
      <button
        type={primaryType}
        class="split-button-primary btn-primary"
        disabled={disabled}
        onClick={primaryType === 'submit' ? undefined : onPrimary}
      >
        {label}
      </button>
      <button
        ref={caret}
        type="button"
        class="split-button-caret btn-primary"
        aria-label={menuLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => (open ? close() : setOpen(true))}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <ChevronDown class="icon" aria-hidden="true" />
      </button>

      {open && (
        <div
          ref={menu}
          class="split-button-menu"
          role="menu"
          aria-label={menuLabel}
          onKeyDown={onMenuKeyDown}
        >
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              class="split-button-item focus-inset"
              onClick={() => {
                // Close without refocusing: the action that follows usually
                // moves focus itself (a submit, a reload), and yanking it back
                // to the caret first would fight that.
                close(false);
                item.onSelect();
              }}
            >
              <span class="split-button-item-label">{item.label}</span>
              {item.sublabel && <span class="split-button-item-sublabel">{item.sublabel}</span>}
            </button>
          ))}
          {footer && <div class="split-button-footer">{footer}</div>}
        </div>
      )}
    </div>
  );
}
