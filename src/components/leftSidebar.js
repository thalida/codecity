// leftSidebar.js — Mounts the left-side activity bar (VSCode-style) and the
// stacked panes it switches between. Owns the active-tab state.
//
// Structure:
//   #tree-sidebar
//     .activity-bar           (vertical icon strip, far-left edge)
//       button[data-tab=tree]
//       button[data-tab=controls]
//     .left-panel             (flex:1, holds the active pane)
//       .left-pane.tree-pane     (visible by default)
//       .left-pane.controls-pane (display:none until selected)

import { buildTreePane } from './tree.js';
import { buildControlsPane } from './controls.js';
import { LUCIDE_ICON_BASE_URL, ACTIVITY_BAR_TABS } from '../config/index.js';
import { DOM_IDS, SIDEBAR_TAB } from '../constants.js';


// showLeftSidebar(manifest, opts)
//
// opts:
//   onResetView — fn() invoked when the Controls panel's Reset button fires
//   applyTheme  — fn() the Settings UI calls after mutating any imported
//                 theme constant (SIDEWALK_COLORS, OUTLINE, etc.) — flushes
//                 the change through to live materials.
//   initialTab  — 'tree' | 'controls' (default 'tree')
export function showLeftSidebar(manifest, opts) {
  opts = opts || {};
  var container = document.getElementById(DOM_IDS.TREE_SIDEBAR);
  if (!container) return;

  while (container.firstChild) container.removeChild(container.firstChild);

  var activityBar = document.createElement('div');
  activityBar.className = 'activity-bar';

  var panel = document.createElement('div');
  panel.className = 'left-panel';

  var panes = {};
  panes[SIDEBAR_TAB.TREE]     = buildTreePane(manifest);
  panes[SIDEBAR_TAB.CONTROLS] = buildControlsPane({
    onResetView: opts.onResetView,
    applyTheme:  opts.applyTheme
  });

  for (var key in panes) {
    if (Object.prototype.hasOwnProperty.call(panes, key)) {
      panel.appendChild(panes[key]);
    }
  }

  var activeTab = (opts.initialTab === SIDEBAR_TAB.CONTROLS) ? SIDEBAR_TAB.CONTROLS : SIDEBAR_TAB.TREE;
  var iconBtns = {};

  var iconBase = LUCIDE_ICON_BASE_URL.get();
  var tabs = ACTIVITY_BAR_TABS.get();
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
}
