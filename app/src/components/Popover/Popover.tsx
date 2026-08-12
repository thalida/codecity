// components/Popover/Popover.tsx — a chrome-bar item that opens a panel of
// controls: the header's scan menu, the footer's appearance menu.
//
// Non-modal and backdrop-free, because these panels change the city behind
// them. role="dialog" rather than menu — they mix actions with form controls,
// and a menu takes only menuitems.
//
// Renders no wrapper: the trigger has to be a direct child of the chrome
// cluster for its dividers and end-rounding to apply, so the trigger and the
// panel are siblings and the cluster is the panel's positioning ancestor.

import './Popover.css';
import { ChevronsUpDown } from 'lucide-preact';
import type { ComponentChildren } from 'preact';
import { useCallback, useRef, useState } from 'preact/hooks';
import { CLUSTER_ITEM_PRESS } from '@/components/ChromeCluster/ChromeCluster';
import { useDismissable } from '@/hooks/useDismissable';

/** Which edge of the trigger the panel grows from, and which end it aligns to.
 *  A bar at the bottom of the window can only open upward. */
export enum PopoverPlacement {
  BelowEnd = 'below-end',
  AboveStart = 'above-start',
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
  children,
}: PopoverProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Stable, so useDismissable doesn't resubscribe every render.
  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }, []);
  useDismissable(open, [triggerRef, panelRef], close);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        class={`${CLUSTER_ITEM_PRESS} popover-trigger${triggerClass ? ` ${triggerClass}` : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={triggerLabel ?? label}
        title={triggerTitle}
        onClick={() => (open ? close(true) : setOpen(true))}
      >
        {trigger}
        {/* Not a down-caret: one of these opens upward, and the same cue has to
            mean "opens" on both bars. Same glyph the project chip uses. */}
        <ChevronsUpDown class="icon popover-caret" aria-hidden="true" />
      </button>

      {open && (
        <div
          ref={panelRef}
          class={`popover-panel popover-panel--${placement} surface-glass${panelClass ? ` ${panelClass}` : ''}`}
          role="dialog"
          aria-label={label}
        >
          {/* Sheet-only (hidden by CSS when anchored), and a real control: a
              grip that only decorates promises a drag it doesn't honour. */}
          <button
            type="button"
            class="popover-grip"
            aria-label="Close"
            onClick={() => close(true)}
          />
          {children(close)}
        </div>
      )}
    </>
  );
}
