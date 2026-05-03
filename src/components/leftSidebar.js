// leftSidebar.js — Mounts the left-side activity bar (VSCode-style) and the
// stacked panes it switches between. Owns the active-tab state and the
// drag-to-resize handle on the sidebar's right edge (width persists in
// localStorage).

import { buildTreePane } from './tree.js';
import { buildControlsPane } from './controls.js';
import {
  DOM_IDS, SIDEBAR_TAB, LUCIDE_ICON_BASE_URL, ACTIVITY_BAR_TABS
} from '../constants.js';

var SIDEBAR_WIDTH_STORAGE_KEY = 'cc.sidebarWidth';
var SIDEBAR_MIN_WIDTH = 280;
var SIDEBAR_MAX_WIDTH = 600;

// showLeftSidebar(manifest, opts)
//
// opts:
//   applyTheme — fn() the Settings UI calls after mutating any imported
//                theme constant — flushes the change through to live materials.
//   initialTab — 'tree' | 'controls' (default 'tree')
//
// (No onResetView callback: the Controls panel's View section shows a
// kbd table with R/Esc/etc. The R key is wired in main.js's keydown
// handler, so this component doesn't need its own callback.)
export function showLeftSidebar(manifest, opts) {
  opts = opts || {};
  var container = document.getElementById(DOM_IDS.TREE_SIDEBAR);
  if (!container) return;

  while (container.firstChild) container.removeChild(container.firstChild);

  // Restore persisted width, if any.
  _applyPersistedWidth(container);

  var activityBar = document.createElement('div');
  activityBar.className = 'activity-bar';

  var panel = document.createElement('div');
  panel.className = 'left-panel';

  var panes = {};
  panes[SIDEBAR_TAB.TREE]     = buildTreePane(manifest);
  panes[SIDEBAR_TAB.CONTROLS] = buildControlsPane({
    applyTheme: opts.applyTheme
  });

  for (var key in panes) {
    if (Object.prototype.hasOwnProperty.call(panes, key)) {
      panel.appendChild(panes[key]);
    }
  }

  var activeTab = (opts.initialTab === SIDEBAR_TAB.CONTROLS) ? SIDEBAR_TAB.CONTROLS : SIDEBAR_TAB.TREE;
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
      btn.addEventListener('click', function () { _setActive(tabId); });
    })(tab.id);

    activityBar.appendChild(btn);
  }

  function _setActive(tabId) {
    if (!panes[tabId]) return;
    activeTab = tabId;
    for (var id in panes) {
      if (Object.prototype.hasOwnProperty.call(panes, id)) {
        panes[id].style.display = (id === tabId) ? '' : 'none';
        if (iconBtns[id]) {
          iconBtns[id].classList.toggle('active', id === tabId);
          iconBtns[id].setAttribute('aria-pressed', String(id === tabId));
        }
      }
    }
  }

  _setActive(activeTab);

  container.appendChild(activityBar);
  container.appendChild(panel);
  container.appendChild(_buildResizeHandle(container));
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
