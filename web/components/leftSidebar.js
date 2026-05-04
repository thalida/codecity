// leftSidebar.js — Mounts the left-side activity bar (VSCode-style) and the
// stacked panes it switches between. Owns:
//   - active-tab state
//   - collapsed/expanded state (clicking the active icon collapses; the ×
//     in the panel header also collapses; persisted in localStorage)
//   - drag-to-resize handle on the sidebar's right edge (also persisted)

import { buildTreePane } from './tree.js';
import { buildInfoPane } from './info.js';
import { buildControlsPane } from './controls.js';
import {
  DOM_IDS, SIDEBAR_TAB, LUCIDE_ICON_BASE_URL, ACTIVITY_BAR_TABS
} from '../constants.js';

var SIDEBAR_WIDTH_STORAGE_KEY     = 'cc.sidebarWidth';
var SIDEBAR_COLLAPSED_STORAGE_KEY = 'cc.sidebarCollapsed';
var SIDEBAR_MIN_WIDTH = 280;
var SIDEBAR_MAX_WIDTH = 600;

// showLeftSidebar(manifest, opts) -> { setSelectedTreePath, setHoveredTreePath }
//
// opts:
//   applyTheme        — fn() the Settings UI calls after mutating any imported
//                       theme constant — flushes the change through to live materials.
//   initialTab        — 'tree' | 'controls' (default 'tree')
//   onTreeSelect      — fn(node) called when the user single-clicks a tree row.
//                       Host wires to _setSelection so tree → city selection
//                       flows through the same channel as a canvas click.
//   onTreeFocus       — fn(node) called when the user double-clicks a tree row.
//                       Host wires to _focusOnBuilding/_focusOnStreet.
//   onTreeHover       — fn(node) on row mouseenter. Host wires to _setHover
//                       so hovering a tree row mirrors into the scene.
//   onTreeHoverEnd    — fn(node) on row mouseleave. Host calls _setHover(null).
//
// Returns an api the host uses to drive the REVERSE direction (city → tree):
//   setSelectedTreePath(path) — keep tree highlight in sync with scene
//                               currentSelection.
//   setHoveredTreePath(path)  — mirror scene hover state to the tree row.
//
// (No onResetView callback: the Controls panel's View section shows a
// kbd table with R/Esc/etc. The R key is wired in main.js's keydown
// handler, so this component doesn't need its own callback.)
export function showLeftSidebar(manifest, opts) {
  opts = opts || {};
  var noop = function () {};
  var container = document.getElementById(DOM_IDS.TREE_SIDEBAR);
  if (!container) return { setSelectedTreePath: noop, setHoveredTreePath: noop };

  while (container.firstChild) container.removeChild(container.firstChild);

  // Restore persisted width, if any.
  _applyPersistedWidth(container);

  var activityBar = document.createElement('div');
  activityBar.className = 'activity-bar';

  var panel = document.createElement('div');
  panel.className = 'left-panel';

  // Each pane renders its own × close button inside its header (flexbox
  // layout in the header keeps title + button vertically aligned without
  // any absolute-positioning math). Clicking either calls _setCollapsed
  // — same effect as clicking the active activity-bar icon a second time.
  var paneOnClose = function () { _setCollapsed(true); };
  var treeBundle = buildTreePane(manifest, {
    onClose:    paneOnClose,
    onSelect:   opts.onTreeSelect,
    onFocus:    opts.onTreeFocus,
    onHover:    opts.onTreeHover,
    onHoverEnd: opts.onTreeHoverEnd
  });
  var infoBundle = buildInfoPane(manifest, { onClose: paneOnClose });
  var panes = {};
  panes[SIDEBAR_TAB.TREE]     = treeBundle.pane;
  panes[SIDEBAR_TAB.INFO]     = infoBundle.pane;
  panes[SIDEBAR_TAB.CONTROLS] = buildControlsPane({
    applyTheme: opts.applyTheme,
    onClose:    paneOnClose
  });

  for (var key in panes) {
    if (Object.prototype.hasOwnProperty.call(panes, key)) {
      panel.appendChild(panes[key]);
    }
  }

  var activeTab = (opts.initialTab === SIDEBAR_TAB.CONTROLS) ? SIDEBAR_TAB.CONTROLS : SIDEBAR_TAB.TREE;
  var collapsed = _loadCollapsed();
  var iconBtns = {};

  var iconBase = LUCIDE_ICON_BASE_URL;
  var tabs = ACTIVITY_BAR_TABS;
  for (var i = 0; i < tabs.length; i++) {
    var tab = tabs[i];
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'activity-bar-icon';
    btn.dataset.tab = tab.id;
    btn.title = tab.title;
    btn.setAttribute('aria-label', tab.title);

    var glyph = document.createElement('span');
    glyph.className = 'activity-bar-glyph';
    glyph.style.maskImage       = 'url(' + iconBase + tab.icon + ')';
    glyph.style.webkitMaskImage = 'url(' + iconBase + tab.icon + ')';
    btn.appendChild(glyph);

    iconBtns[tab.id] = btn;

    (function (tabId) {
      btn.addEventListener('click', function () { _onIconClick(tabId); });
    })(tab.id);

    activityBar.appendChild(btn);
  }

  // _onIconClick — the same icon while expanded collapses; any other
  // icon (or any icon while collapsed) opens the sidebar with that tab.
  function _onIconClick(tabId) {
    if (!panes[tabId]) return;
    if (!collapsed && tabId === activeTab) {
      _setCollapsed(true);
      return;
    }
    if (collapsed) _setCollapsed(false);
    _setActive(tabId);
  }

  function _setActive(tabId) {
    if (!panes[tabId]) return;
    activeTab = tabId;
    _refreshActiveStates();
  }

  function _setCollapsed(value) {
    collapsed = value;
    container.classList.toggle('is-collapsed', collapsed);
    _refreshActiveStates();
    _persistCollapsed(collapsed);
  }

  // Sync the visible state of all panes + activity-bar icons against
  // the (activeTab, collapsed) tuple. When collapsed, NO icon shows as
  // active — the user is parked at "no pane visible".
  function _refreshActiveStates() {
    for (var id in panes) {
      if (!Object.prototype.hasOwnProperty.call(panes, id)) continue;
      panes[id].style.display = (id === activeTab) ? '' : 'none';
    }
    for (var iid in iconBtns) {
      if (!Object.prototype.hasOwnProperty.call(iconBtns, iid)) continue;
      var isActive = !collapsed && iid === activeTab;
      iconBtns[iid].classList.toggle('active', isActive);
      iconBtns[iid].setAttribute('aria-pressed', String(isActive));
    }
  }

  _refreshActiveStates();

  container.classList.toggle('is-collapsed', collapsed);

  container.appendChild(activityBar);
  container.appendChild(panel);
  container.appendChild(_buildResizeHandle(container));

  return {
    setSelectedTreePath: treeBundle.api.setSelectedPath,
    setHoveredTreePath:  treeBundle.api.setHoveredPath,
    setInfoManifest:     infoBundle.api.setManifest
  };
}

// _buildResizeHandle(sidebar) — a thin invisible strip on the sidebar's
// right edge. Drag to resize; the chosen width is clamped to [MIN, MAX]
// and persisted in localStorage.
function _buildResizeHandle(sidebar) {
  var handle = document.createElement('div');
  handle.className = 'sidebar-resize-handle';
  handle.setAttribute('role', 'separator');
  handle.setAttribute('aria-orientation', 'vertical');
  handle.title = 'Drag to resize';

  var dragging = false;
  handle.addEventListener('pointerdown', function (e) {
    dragging = true;
    handle.classList.add('dragging');
    handle.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  handle.addEventListener('pointermove', function (e) {
    if (!dragging) return;
    var w = e.clientX;
    if (w < SIDEBAR_MIN_WIDTH) w = SIDEBAR_MIN_WIDTH;
    if (w > SIDEBAR_MAX_WIDTH) w = SIDEBAR_MAX_WIDTH;
    sidebar.style.width = w + 'px';
  });
  handle.addEventListener('pointerup', function (e) {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    handle.releasePointerCapture(e.pointerId);
    _persistWidth(parseFloat(sidebar.style.width) || sidebar.offsetWidth);
  });
  return handle;
}

function _applyPersistedWidth(sidebar) {
  if (typeof localStorage === 'undefined') return;
  try {
    var raw = localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
    if (raw == null) return;
    var w = parseFloat(raw);
    if (!Number.isFinite(w)) return;
    if (w < SIDEBAR_MIN_WIDTH) w = SIDEBAR_MIN_WIDTH;
    if (w > SIDEBAR_MAX_WIDTH) w = SIDEBAR_MAX_WIDTH;
    sidebar.style.width = w + 'px';
  } catch (_) { /* private mode / no storage — silently fall back to CSS default */ }
}

function _persistWidth(w) {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(w)); }
  catch (_) { /* quota / private — drop */ }
}

function _loadCollapsed() {
  if (typeof localStorage === 'undefined') return false;
  try { return localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === 'true'; }
  catch (_) { return false; }
}

function _persistCollapsed(value) {
  if (typeof localStorage === 'undefined') return;
  try {
    if (value) localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, 'true');
    else       localStorage.removeItem(SIDEBAR_COLLAPSED_STORAGE_KEY);
  } catch (_) { /* drop */ }
}
