// components/Sidebar.tsx — Shared sidebar chrome: the <aside> shell + a
// drag-to-resize handle. LeftSidebar / RightSidebar fill in their own content
// and state class; the resize mechanics live here once so the two can't drift.

import './Sidebar.css';
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

/** Which screen edge the sidebar docks to. Determines the resize handle's edge
 *  + class, how a drag maps to width, and which CSS target receives the width. */
export enum SidebarSide {
  Left = 'left',
  Right = 'right',
}

// A drag's pointer X → raw sidebar width. The left sidebar grows rightward from
// the screen's left edge (width = clientX); the right sidebar grows leftward
// from the right edge (width = viewport − clientX).
function _measureWidth(side: SidebarSide, e: PointerEvent): number {
  return side === SidebarSide.Left ? e.clientX : window.innerWidth - e.clientX;
}

// Both sidebars drive a `--sidebar-width` CSS var; CSS owns the actual `width`
// (`width: var(--sidebar-width, <default>)`), so the handle never fights inline
// styles or the open/close transition.
function _applyWidth(el: HTMLElement, w: number): void {
  el.style.setProperty('--sidebar-width', `${w}px`);
}

interface ResizeHandleProps {
  side: SidebarSide;
  targetRef: { current: HTMLElement | null };
}

function ResizeHandle({ side, targetRef }: ResizeHandleProps) {
  // `dragging` is a ref (sync guard for pointermove — no stale-closure race);
  // `isDragging` is state, driving the visual `.dragging` class declaratively.
  const dragging = useRef(false);
  const [isDragging, setIsDragging] = useState(false);

  const onPointerDown = (e: PointerEvent) => {
    dragging.current = true;
    setIsDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!dragging.current || !targetRef.current) return;
    // Feed the raw measured width to the var; CSS min-width/max-width clamp the
    // rendered result (so the handle stops at the bounds without JS knowing them).
    _applyWidth(targetRef.current, _measureWidth(side, e));
  };
  const onPointerUp = (e: PointerEvent) => {
    if (!dragging.current) return;
    dragging.current = false;
    setIsDragging(false);
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  };

  const cls =
    side === SidebarSide.Left
      ? 'resize-handle resize-handle--right'
      : 'resize-handle resize-handle--left';
  return (
    <div
      class={`${cls}${isDragging ? ' dragging' : ''}`}
      role="separator"
      aria-orientation="vertical"
      title="Drag to resize"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    />
  );
}

export interface SidebarProps {
  /** DOM id — drives CSS (e.g. #left-sidebar). */
  id: string;
  side: SidebarSide;
  /** Accessible name for the complementary landmark, so the two <aside>s are
   *  distinguishable to assistive tech. */
  ariaLabel?: string;
  /** State class for the <aside> (e.g. 'is-collapsed', 'open'); caller-computed. */
  class?: string;
  /** Whether the panel is showing. A drag lasts only as long as one visit. */
  open: boolean;
  children: ComponentChildren;
}

export function Sidebar({ id, side, class: cls, ariaLabel, open, children }: SidebarProps) {
  const ref = useRef<HTMLElement>(null);

  // Each visit starts at the CSS default: a width dragged for one file is
  // rarely the width wanted for the next.
  useEffect(() => {
    if (open) ref.current?.style.removeProperty('--sidebar-width');
  }, [open]);

  return (
    <aside
      ref={ref}
      id={id}
      class={cls ? `surface-sidebar ${cls}` : 'surface-sidebar'}
      aria-label={ariaLabel}
    >
      {children}
      <ResizeHandle side={side} targetRef={ref} />
    </aside>
  );
}
