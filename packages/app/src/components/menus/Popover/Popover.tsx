// components/menus/Popover/Popover.tsx — a chrome-bar item that opens a panel of
// controls. Anchored it is non-modal (the panel changes the city behind it); as
// a phone sheet it takes a scrim. The panel portals to <body> and is placed from
// the trigger's rect: a cluster styles every child it holds as one of its items.

import './Popover.css';
import { ChevronsUpDown } from 'lucide-preact';
import type { ComponentChildren } from 'preact';
import { createPortal } from 'preact/compat';
import { useSignal, type Signal } from '@preact/signals';
import { useCallback, useId, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { useDismissable } from '@/hooks/useDismissable';
import { IS_PHONE } from '@/state/viewport';

/** Which edge of the trigger the panel grows from, and which end it aligns to.
 *  A bar at the bottom of the window can only open upward. */
export enum PopoverPlacement {
  BelowEnd = 'below-end',
  AboveStart = 'above-start',
}

/** Viewport insets that line the panel up with its trigger; the gap between the
 *  two is a CSS margin. Null while the panel is a sheet, which spans the window. */
type AnchorOffset = { top: number; right: number } | { bottom: number; left: number };

/** Gap kept between the panel and the window edge when a trigger sits so far
 *  along the bar that aligning to it would push the panel off-screen. */
const VIEWPORT_GUTTER = 8;

function measureAnchor(
  trigger: HTMLElement | null,
  panel: HTMLElement | null,
  placement: PopoverPlacement
): AnchorOffset | null {
  if (!trigger || !panel) return null;
  // Sheet: pinned to the window's edges, so an inline offset would fight the
  // media query rather than refine it.
  if (IS_PHONE.peek()) return null;

  const rect = trigger.getBoundingClientRect();
  // The inset that would leave the panel's far edge on the gutter.
  const maxInline = window.innerWidth - VIEWPORT_GUTTER - panel.offsetWidth;
  if (placement === PopoverPlacement.BelowEnd) {
    // Trailing edges flush, clamped so the panel's leading edge stays on screen.
    return { top: rect.bottom, right: Math.min(window.innerWidth - rect.right, maxInline) };
  }
  // Leading edges flush, clamped the same way against the other edge.
  return { bottom: window.innerHeight - rect.top, left: Math.min(rect.left, maxInline) };
}

export interface PopoverProps {
  /** Names the panel, and the trigger unless triggerLabel overrides it. */
  label: string;
  /** Inside the trigger button, before the caret. */
  trigger: ComponentChildren;
  triggerLabel?: string;
  triggerTitle?: string;
  triggerClass?: string;
  placement: PopoverPlacement;
  panelClass?: string;
  /** Pinned below the scrolling body. For actions that must stay reachable
   *  however far the panel's content runs. Receives `close`, as children do. */
  footer?: (close: (refocus: boolean) => void) => ComponentChildren;
  /** Open state to share, for a panel something outside can open (the "?" key
   *  opens shortcuts) or that other state reads. Omit to keep it internal. */
  openSignal?: Signal<boolean>;
  /** Receives `close` so an action inside can dismiss the panel it sits in. */
  children: (close: (refocus: boolean) => void) => ComponentChildren;
}

export function Popover({
  label,
  trigger,
  triggerLabel,
  triggerTitle,
  triggerClass,
  placement,
  panelClass,
  footer,
  openSignal,
  children,
}: PopoverProps) {
  const titleId = useId();
  // Always created (hook rules); ignored when the caller supplies its own.
  const ownOpen = useSignal(false);
  const isOpen = openSignal ?? ownOpen;
  const open = isOpen.value;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Stable, so useDismissable doesn't resubscribe every render.
  const close = useCallback(
    (refocus: boolean) => {
      isOpen.value = false;
      if (refocus) triggerRef.current?.focus();
    },
    [isOpen]
  );
  useDismissable(open, [triggerRef, panelRef], close);

  // The panel is out of the bar's tree, so nothing about where the trigger sits
  // reaches it: measure. Siblings decide where a trigger is.
  const [anchor, setAnchor] = useState<AnchorOffset | null>(null);
  useLayoutEffect(() => {
    if (!open) {
      setAnchor(null);
      return;
    }
    const measure = () => setAnchor(measureAnchor(triggerRef.current, panelRef.current, placement));
    measure();
    // A resize moves the trigger, and can cross the sheet breakpoint, where the
    // panel spans the viewport and an inline offset would fight the media query.
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [open, placement]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        class={`popover-trigger${triggerClass ? ` ${triggerClass}` : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={triggerLabel ?? label}
        title={triggerTitle}
        onClick={() => (open ? close(true) : (isOpen.value = true))}
      >
        {trigger}
        {/* Not a down-caret: one of these opens upward, and the same cue has to
            mean "opens" on both bars. */}
        <ChevronsUpDown class="icon cluster-cue" aria-hidden="true" />
      </button>

      {open &&
        createPortal(
          <>
            {/* Sheet-only (CSS). Not a control: useDismissable already closes on
                a press outside, and the panel's grip is the labelled way out. */}
            <div class="popover-scrim" aria-hidden="true" />

            <div
              ref={panelRef}
              class={`popover-panel popover-panel--${placement} surface-glass${panelClass ? ` ${panelClass}` : ''}`}
              role="dialog"
              aria-labelledby={titleId}
              style={anchor ?? undefined}
            >
              {/* Sheet-only (hidden by CSS when anchored), and a real control: a
                  grip that only decorates promises a drag it doesn't honour. */}
              <button
                type="button"
                class="popover-grip"
                aria-label="Close"
                onClick={() => close(true)}
              />
              {/* The panel's name, shown rather than only announced: a portal
                  panel has no trigger beside it to say what you opened. */}
              <div class="popover-header">
                <h2 id={titleId} class="popover-title">
                  {label}
                </h2>
              </div>
              <div class="popover-body">{children(close)}</div>
              {footer && <div class="popover-footer">{footer(close)}</div>}
            </div>
          </>,
          document.body
        )}
    </>
  );
}
