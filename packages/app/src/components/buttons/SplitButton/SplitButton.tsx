// components/buttons/SplitButton/SplitButton.tsx — a primary action plus a caret that
// opens a menu of variants on the same action (Open / Open with a fresh scan).
// The default stays one press; a variant costs two, which is the point.

import './SplitButton.css';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { ChevronDown, type LucideIcon } from 'lucide-preact';
import { useDismissable } from '@/hooks/useDismissable';

export interface SplitButtonItem {
  id: string;
  label: string;
  icon?: LucideIcon;
  /** One line under the label saying what it does differently. */
  sublabel?: string;
  onSelect: () => void;
}

export interface SplitButtonProps {
  label: string;
  icon?: LucideIcon;
  onPrimary: () => void;
  items: SplitButtonItem[];
  disabled?: boolean;
  /** `submit` lets the primary half drive a real <form>, so Enter in a field
   *  and a click on the button take the same path. */
  primaryType?: 'button' | 'submit';
  /** Accessible name for the caret, e.g. "More open options". */
  menuLabel: string;
  class?: string;
}

export function SplitButton({
  label,
  icon: Icon,
  onPrimary,
  items,
  disabled,
  primaryType = 'button',
  menuLabel,
  class: className,
}: SplitButtonProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const caret = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) caret.current?.focus();
  }, []);
  useDismissable(open, [root], close);

  useEffect(() => {
    if (!open) return;
    // Focus the first item so the keyboard path continues where the eye is.
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open]);

  function onMenuKeyDown(e: KeyboardEvent) {
    const focusable = Array.from(
      menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []
    );
    const idx = focusable.indexOf(document.activeElement as HTMLElement);
    switch (e.key) {
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
    <div ref={root} class={`split-button${className ? ` ${className}` : ''}`}>
      <button
        type={primaryType}
        class="split-button-primary btn-primary"
        disabled={disabled}
        onClick={primaryType === 'submit' ? undefined : onPrimary}
      >
        {Icon && <Icon class="icon" aria-hidden="true" />}
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
        onClick={() => (open ? close(true) : setOpen(true))}
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
          role="menu"
          aria-label={menuLabel}
          class="split-button-menu surface-glass"
          onKeyDown={onMenuKeyDown}
        >
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              class="split-button-item focus-inset"
              onClick={() => {
                // No refocus: the action usually moves focus itself.
                close(false);
                item.onSelect();
              }}
            >
              {item.icon && <item.icon class="icon split-button-item-icon" aria-hidden="true" />}
              <span class="split-button-item-label">{item.label}</span>
              {item.sublabel && <span class="split-button-item-sublabel">{item.sublabel}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
