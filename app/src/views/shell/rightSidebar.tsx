// views/shell/rightSidebar.tsx — chrome for the right-side panel. Owns:
//   - the .open class that drives the open/close transition
//   - the drag-to-resize handle on the inside (left) edge
//   - persisting the chosen width across reloads
//   - mounting one pane element into the slot
//
// Exactly one pane is mounted at a time. The coordinator builds a pane
// (filePreviewPane today) and hands it in via showRightSidebar(pane).
// Subsequent calls with the same pane reference are no-ops; passing a
// different pane swaps it. Body-level rendering lives in the pane, not
// here — see views/panes/filePreviewPane.tsx.

import { h } from 'preact';
import { signal } from '@preact/signals';
import type { ReadonlySignal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { DOM_IDS, STORAGE_KEYS } from '@/constants';

// Persistent width range (in px) for the right sidebar drag handle.
const SIDEBAR_MIN_WIDTH = 280;
const SIDEBAR_MAX_WIDTH_RATIO = 0.7; // fraction of viewport width

// ── State shape for Preact component ─────────────────────────────────────────

export interface RightSidebarState {
  isOpen: boolean;
  pane: HTMLElement | null;
}

// ── Resize handle helpers ─────────────────────────────────────────────────────

function _ensureResizeHandle(sidebar: HTMLElement): void {
  if (sidebar.querySelector('.sidebar-resize-handle-right')) return;

  const handle = document.createElement('div');
  handle.className = 'sidebar-resize-handle-right';
  handle.setAttribute('role', 'separator');
  handle.setAttribute('aria-orientation', 'vertical');
  handle.title = 'Drag to resize';

  let dragging = false;
  let liveWidth = 0;

  handle.addEventListener('pointerdown', (e) => {
    dragging = true;
    handle.classList.add('dragging');
    handle.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  handle.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    let w = window.innerWidth - e.clientX;
    const maxW = Math.floor(window.innerWidth * SIDEBAR_MAX_WIDTH_RATIO);
    if (w < SIDEBAR_MIN_WIDTH) w = SIDEBAR_MIN_WIDTH;
    if (w > maxW) w = maxW;
    liveWidth = w;
    sidebar.style.setProperty('--sidebar-width', `${w}px`);
  });
  handle.addEventListener('pointerup', (e) => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    handle.releasePointerCapture(e.pointerId);
    _persistWidth(liveWidth || sidebar.offsetWidth);
  });

  sidebar.appendChild(handle);
}

function _applyPersistedWidth(sidebar: HTMLElement): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.FILE_SIDEBAR_WIDTH);
    if (raw == null) return;
    let w = parseFloat(raw);
    if (!Number.isFinite(w)) return;
    const maxW = Math.floor(window.innerWidth * SIDEBAR_MAX_WIDTH_RATIO);
    if (w < SIDEBAR_MIN_WIDTH) w = SIDEBAR_MIN_WIDTH;
    if (w > maxW) w = maxW;
    sidebar.style.setProperty('--sidebar-width', `${w}px`);
  } catch (_) {
    /* private mode / no storage — fall back to CSS default */
  }
}

function _persistWidth(w: number): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEYS.FILE_SIDEBAR_WIDTH, String(w));
  } catch (_) {
    /* drop */
  }
}

// ── DOM helpers ───────────────────────────────────────────────────────────────

function _currentPane(sidebar: HTMLElement): Element | null {
  const children = sidebar.children;
  for (let i = 0; i < children.length; i++) {
    if (!children[i].classList.contains('sidebar-resize-handle-right')) {
      return children[i];
    }
  }
  return null;
}

function _clearMountedPane(sidebar: HTMLElement): void {
  for (const child of [...sidebar.children]) {
    if (!child.classList.contains('sidebar-resize-handle-right')) {
      sidebar.removeChild(child);
    }
  }
}

// ── Preact component ─────────────────────────────────────────────────────────
// Used when App.tsx mounts RightSidebar directly (Phase 3e+). The component
// reads the state signal and applies DOM mutations via useEffect.

interface RightSidebarProps {
  state: ReadonlySignal<RightSidebarState>;
  sidebarEl: HTMLElement;
}

export function RightSidebar({ state, sidebarEl }: RightSidebarProps) {
  const { isOpen, pane } = state.value;

  useEffect(() => {
    sidebarEl.classList.toggle('open', isOpen);
  }, [isOpen, sidebarEl]);

  useEffect(() => {
    _ensureResizeHandle(sidebarEl);
    _applyPersistedWidth(sidebarEl);
    if (pane) {
      const current = _currentPane(sidebarEl);
      if (current !== pane) {
        _clearMountedPane(sidebarEl);
        sidebarEl.appendChild(pane);
      }
    }
  }, [pane, sidebarEl]);

  // No visual output — all changes are imperative DOM mutations on sidebarEl
  return null;
}

// ── Backward-compat shims ─────────────────────────────────────────────────────
// Phase 3e will delete these once App.tsx mounts <RightSidebar /> directly.
// The shims are fully synchronous (matching original behavior) to preserve
// test compatibility — DOM mutations are applied directly, not via useEffect.

/**
 * Mount `pane` (a DOM element) into the right sidebar slot and open the
 * panel. Idempotent: passing the already-mounted pane does NOT clear or
 * re-append. Passing a different pane swaps the mounted one.
 */
export function showRightSidebar(pane: HTMLElement): void {
  const sidebar = document.getElementById(DOM_IDS.FILE_SIDEBAR);
  if (!sidebar) return;

  _ensureResizeHandle(sidebar);
  _applyPersistedWidth(sidebar);

  if (pane && _currentPane(sidebar) !== pane) {
    _clearMountedPane(sidebar);
    sidebar.appendChild(pane);
  }

  sidebar.classList.add('open');
}

/**
 * Hide the sidebar (remove the .open class so it collapses to width 0).
 * Pure DOM mutation; the mounted pane stays in the DOM so it can re-open
 * without rebuilding.
 */
export function hideRightSidebar(): void {
  const sidebar = document.getElementById(DOM_IDS.FILE_SIDEBAR);
  if (sidebar) sidebar.classList.remove('open');
}
