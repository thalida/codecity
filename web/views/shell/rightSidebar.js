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

import { DOM_IDS } from '../../constants.js';

// Persistent width range (in px) for the right sidebar drag handle.
var SIDEBAR_MIN_WIDTH = 280;
var SIDEBAR_MAX_WIDTH_RATIO = 0.7;  // fraction of viewport width
var SIDEBAR_WIDTH_STORAGE_KEY = 'cc.fileSidebarWidth';

/**
 * Mount `pane` (a DOM element) into the right sidebar slot and open the
 * panel. Idempotent: passing the already-mounted pane does NOT clear or
 * re-append. Passing a different pane swaps the mounted one.
 *
 * @param {HTMLElement} pane
 */
export function showRightSidebar(pane) {
  var sidebar = document.getElementById(DOM_IDS.FILE_SIDEBAR);
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
export function hideRightSidebar() {
  var sidebar = document.getElementById(DOM_IDS.FILE_SIDEBAR);
  if (sidebar) sidebar.classList.remove('open');
}

// _currentPane(sidebar) — return the currently mounted pane element (the
// non-resize-handle child), or null if nothing is mounted yet.
function _currentPane(sidebar) {
  var children = sidebar.children;
  for (var i = 0; i < children.length; i++) {
    if (!children[i].classList.contains('sidebar-resize-handle-right')) {
      return children[i];
    }
  }
  return null;
}

function _clearMountedPane(sidebar) {
  // Keep .sidebar-resize-handle-right across pane swaps so we don't have
  // to re-bind drag listeners on every selection change.
  var children = Array.prototype.slice.call(sidebar.children);
  for (var i = 0; i < children.length; i++) {
    if (!children[i].classList.contains('sidebar-resize-handle-right')) {
      sidebar.removeChild(children[i]);
    }
  }
}

function _ensureResizeHandle(sidebar) {
  if (sidebar.querySelector('.sidebar-resize-handle-right')) return;

  var handle = document.createElement('div');
  handle.className = 'sidebar-resize-handle-right';
  handle.setAttribute('role', 'separator');
  handle.setAttribute('aria-orientation', 'vertical');
  handle.title = 'Drag to resize';

  var dragging = false;
  var liveWidth = 0;  // tracked across pointermove so we can persist on up

  handle.addEventListener('pointerdown', function (e) {
    dragging = true;
    handle.classList.add('dragging');
    handle.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  handle.addEventListener('pointermove', function (e) {
    if (!dragging) return;
    var w = window.innerWidth - e.clientX;
    var maxW = Math.floor(window.innerWidth * SIDEBAR_MAX_WIDTH_RATIO);
    if (w < SIDEBAR_MIN_WIDTH) w = SIDEBAR_MIN_WIDTH;
    if (w > maxW)              w = maxW;
    liveWidth = w;
    // Drive width via the CSS variable so the open/close rule
    // `width: var(--sidebar-width)` keeps working without an inline width
    // override fighting the .open/.is-animating transitions.
    sidebar.style.setProperty('--sidebar-width', w + 'px');
  });
  handle.addEventListener('pointerup', function (e) {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    handle.releasePointerCapture(e.pointerId);
    _persistWidth(liveWidth || sidebar.offsetWidth);
  });

  sidebar.appendChild(handle);
}

function _applyPersistedWidth(sidebar) {
  if (typeof localStorage === 'undefined') return;
  try {
    var raw = localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
    if (raw == null) return;
    var w = parseFloat(raw);
    if (!Number.isFinite(w)) return;
    var maxW = Math.floor(window.innerWidth * SIDEBAR_MAX_WIDTH_RATIO);
    if (w < SIDEBAR_MIN_WIDTH) w = SIDEBAR_MIN_WIDTH;
    if (w > maxW)              w = maxW;
    sidebar.style.setProperty('--sidebar-width', w + 'px');
  } catch (_) { /* private mode / no storage — fall back to CSS default */ }
}

function _persistWidth(w) {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(w)); }
  catch (_) { /* drop */ }
}
