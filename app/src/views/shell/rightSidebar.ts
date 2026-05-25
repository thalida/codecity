// views/shell/rightSidebar.js — chrome for the right-side panel. Owns:
//   - the .open class that drives the open/close transition
//   - the drag-to-resize handle on the inside (left) edge
//   - persisting the chosen width across reloads
//   - mounting one pane element into the slot
//
// Exactly one pane is mounted at a time. The coordinator builds a pane
// (filePreviewPane today) and hands it in via showRightSidebar(pane).
// Subsequent calls with the same pane reference are no-ops; passing a
// different pane swaps it. Body-level rendering lives in the pane, not
// here — see views/panes/filePreviewPane.js.

import { DOM_IDS, STORAGE_KEYS } from '@/constants';

// Persistent width range (in px) for the right sidebar drag handle.
const SIDEBAR_MIN_WIDTH = 280;
const SIDEBAR_MAX_WIDTH_RATIO = 0.7; // fraction of viewport width

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

// _currentPane(sidebar) — return the currently mounted pane element (the
// non-resize-handle child), or null if nothing is mounted yet.
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
  // Keep .sidebar-resize-handle-right across pane swaps so we don't have
  // to re-bind drag listeners on every selection change.
  for (const child of [...sidebar.children]) {
    if (!child.classList.contains('sidebar-resize-handle-right')) {
      sidebar.removeChild(child);
    }
  }
}

function _ensureResizeHandle(sidebar: HTMLElement): void {
  if (sidebar.querySelector('.sidebar-resize-handle-right')) return;

  const handle = document.createElement('div');
  handle.className = 'sidebar-resize-handle-right';
  handle.setAttribute('role', 'separator');
  handle.setAttribute('aria-orientation', 'vertical');
  handle.title = 'Drag to resize';

  let dragging = false;
  let liveWidth = 0; // tracked across pointermove so we can persist on up

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
    // Drive width via the CSS variable so the open/close rule
    // `width: var(--sidebar-width)` keeps working without an inline width
    // override fighting the .open/.is-animating transitions.
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
