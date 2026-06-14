// components/Sidebar.tsx — Shared sidebar chrome: the <aside> shell + a
// drag-to-resize handle whose width persists via a caller-supplied signal.
// LeftSidebar / RightSidebar fill in their own content and state class; the
// resize mechanics (which edge, how a drag maps to width, where the width is
// applied, persistence) live here once so the two can't drift.

import type { ComponentChildren } from 'preact';
import type { Signal } from '@preact/signals';
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
  widthSignal: Signal<number | null>;
}

function ResizeHandle({ side, targetRef, widthSignal }: ResizeHandleProps) {
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
    if (!dragging.current || !targetRef.current) return;
    dragging.current = false;
    setIsDragging(false);
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    // Persist the actual rendered width — already clamped to the CSS bounds.
    widthSignal.value = targetRef.current.offsetWidth;
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
  /** State class for the <aside> (e.g. 'is-collapsed', 'open'); caller-computed. */
  class?: string;
  /** Persisted drag-resize width (px); null ⇒ fall back to the CSS default.
   *  The allowed range is the CSS min-width/max-width on the sidebar's id rule
   *  — not duplicated here. */
  widthSignal: Signal<number | null>;
  children: ComponentChildren;
}

export function Sidebar({ id, side, class: cls, widthSignal, children }: SidebarProps) {
  const ref = useRef<HTMLElement>(null);

  // Apply the persisted width on mount. CSS min-width/max-width clamp it, so a
  // stale/corrupted value (or one from a since-shrunk viewport) can't overflow.
  useEffect(() => {
    const w = widthSignal.peek();
    if (w != null && ref.current) _applyWidth(ref.current, w);
  }, []);

  return (
    <aside ref={ref} id={id} class={cls ?? ''}>
      {children}
      <ResizeHandle side={side} targetRef={ref} widthSignal={widthSignal} />
    </aside>
  );
}
