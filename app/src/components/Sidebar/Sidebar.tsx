// components/Sidebar.tsx — Shared sidebar chrome: the <aside> shell + a
// drag-to-resize handle. CitySidebarLeft / CitySidebarRight fill in their own content
// and state class; the resize mechanics live here once so the two can't drift.

import './Sidebar.css';
import { createContext, type ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

/** Which screen edge the sidebar docks to. Determines the resize handle's edge
 *  + class, how a drag maps to width, and which CSS target receives the width. */
export enum SidebarSide {
  Left = 'left',
  Right = 'right',
}

/** Which edge the sidebar docks to, for descendants that draw differently by
 *  side. Context, or every pane in between would have to forward it. */
export const SidebarSideContext = createContext<SidebarSide | null>(null);

// Pointer X to width: the left panel grows from the left edge, the right one
// from the right.
function _measureWidth(side: SidebarSide, e: PointerEvent): number {
  return side === SidebarSide.Left ? e.clientX : window.innerWidth - e.clientX;
}

// Everything the row has, less what the other panels hold. The canvas can
// surrender all of its width; the other sidebar is a wall.
function _maxWidth(el: HTMLElement): number {
  const row = el.parentElement;
  if (!row) return Number.POSITIVE_INFINITY;
  let others = 0;
  for (const sibling of Array.from(row.querySelectorAll(':scope > aside'))) {
    if (sibling !== el) others += (sibling as HTMLElement).offsetWidth;
  }
  return Math.max(0, row.clientWidth - others);
}

// A drag writes a custom property and CSS owns the width, so it never fights
// the open and collapsed rules.
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
    // CSS clamps its own bounds; the one it can't express is the room the
    // other panel is holding, so that cap lives here.
    const el = targetRef.current;
    _applyWidth(el, Math.min(_measureWidth(side, e), _maxWidth(el)));
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
  /** DOM id — drives CSS (e.g. #city-sidebar-left). */
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
      <SidebarSideContext.Provider value={side}>{children}</SidebarSideContext.Provider>
      <ResizeHandle side={side} targetRef={ref} />
    </aside>
  );
}
