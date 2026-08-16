// components/menus/Popover/Popover.tsx — a chrome-bar item that opens a panel of
// controls. Anchored it is non-modal (the panel changes the city behind it);
// as a phone sheet it takes a scrim. Renders no wrapper: the trigger must be a
// direct child of the cluster, which is therefore the panel's offset parent.

import './Popover.css';
import { ChevronsUpDown } from 'lucide-preact';
import type { ComponentChildren } from 'preact';
import { useSignal, type Signal } from '@preact/signals';
import { useCallback, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { useDismissable } from '@/hooks/useDismissable';
import { IS_PHONE } from '@/state/stores/viewport';

/** Which edge of the trigger the panel grows from, and which end it aligns to.
 *  A bar at the bottom of the window can only open upward. */
export enum PopoverPlacement {
  BelowEnd = 'below-end',
  AboveStart = 'above-start',
}

/** Inline inset that lines the panel up with its trigger, in offset-parent
 *  coordinates. Null while the panel is a sheet, which spans the viewport. */
type AnchorOffset = { left: number } | { right: number };

/** Gap kept between the panel and the window edge when a trigger sits so far
 *  along the bar that aligning to it would push the panel off-screen. */
const VIEWPORT_GUTTER = 8;

function measureAnchor(
  trigger: HTMLElement | null,
  panel: HTMLElement | null,
  placement: PopoverPlacement
): AnchorOffset | null {
  const parent = trigger?.offsetParent as HTMLElement | null;
  if (!trigger || !panel || !parent) return null;
  // Sheet: pinned to the window's edges, so an inline offset would fight the
  // media query rather than refine it.
  if (IS_PHONE.peek()) return null;

  const parentRect = parent.getBoundingClientRect();
  if (placement === PopoverPlacement.BelowEnd) {
    // Trailing edges flush, clamped so the panel's leading edge stays on screen.
    const fromRight = parent.clientWidth - (trigger.offsetLeft + trigger.offsetWidth);
    const leftIfApplied = parentRect.right - fromRight - panel.offsetWidth;
    const overshoot = VIEWPORT_GUTTER - leftIfApplied;
    return { right: overshoot > 0 ? fromRight - overshoot : fromRight };
  }
  // Leading edges flush, clamped the same way against the other edge.
  const maxLeft = window.innerWidth - VIEWPORT_GUTTER - panel.offsetWidth - parentRect.left;
  return { left: Math.min(trigger.offsetLeft, maxLeft) };
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
  openSignal,
  children,
}: PopoverProps) {
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

  // The offset parent is the whole cluster, so without this every item opens
  // its panel in the same spot. Measured: siblings decide where a trigger is.
  const [anchor, setAnchor] = useState<AnchorOffset | null>(null);
  useLayoutEffect(() => {
    if (!open) {
      setAnchor(null);
      return;
    }
    const measure = () => setAnchor(measureAnchor(triggerRef.current, panelRef.current, placement));
    measure();
    // A resize can cross the sheet breakpoint, where the panel spans the
    // viewport and an inline offset would fight the media query.
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
            mean "opens" on both bars. Same glyph the project chip uses. */}
        <ChevronsUpDown class="icon cluster-cue" aria-hidden="true" />
      </button>

      {/* Sheet-only (CSS). Not a control: useDismissable already closes on a
          press outside, and the panel's grip is the labelled way out. */}
      {open && <div class="popover-scrim" aria-hidden="true" />}

      {open && (
        <div
          ref={panelRef}
          class={`popover-panel popover-panel--${placement} surface-glass${panelClass ? ` ${panelClass}` : ''}`}
          role="dialog"
          aria-label={label}
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
          {children(close)}
        </div>
      )}
    </>
  );
}
