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


// Lucide icons fetched at runtime — same CDN pattern as Three.js. CSS uses
// these as mask-image so the icon stroke takes the button's text color.
var ICON_BASE = 'https://cdn.jsdelivr.net/npm/lucide-static@latest/icons/';
var TABS = [
  { id: 'tree',     icon: 'folder-tree.svg',        title: 'Tree'     },
  { id: 'controls', icon: 'sliders-horizontal.svg', title: 'Controls' }
];


// showLeftSidebar(manifest, opts)
//
// opts:
//   initialHeightMode  — 'compact' | 'exact'
//   onHeightModeChange — fn(newMode)
//   onResetView        — fn() invoked when the Controls panel's Reset button fires
//   initialTab         — 'tree' | 'controls' (default 'tree')
export function showLeftSidebar(manifest, opts) {
  opts = opts || {};
  var container = document.getElementById('tree-sidebar');
  if (!container) return;

  while (container.firstChild) container.removeChild(container.firstChild);

  var activityBar = document.createElement('div');
  activityBar.className = 'activity-bar';

  var panel = document.createElement('div');
  panel.className = 'left-panel';

  var panes = {
    tree:     buildTreePane(manifest),
    controls: buildControlsPane({
      initialHeightMode:  opts.initialHeightMode,
      onHeightModeChange: opts.onHeightModeChange,
      onResetView:        opts.onResetView
    })
  };

  for (var key in panes) {
    if (Object.prototype.hasOwnProperty.call(panes, key)) {
      panel.appendChild(panes[key]);
    }
  }

  var activeTab = (opts.initialTab === 'controls') ? 'controls' : 'tree';
  var iconBtns = {};

  for (var i = 0; i < TABS.length; i++) {
    var tab = TABS[i];
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'activity-bar-icon';
    btn.dataset.tab = tab.id;
    btn.title = tab.title;
    btn.setAttribute('aria-label', tab.title);

    var glyph = document.createElement('span');
    glyph.className = 'activity-bar-glyph';
    glyph.style.maskImage         = 'url(' + ICON_BASE + tab.icon + ')';
    glyph.style.webkitMaskImage   = 'url(' + ICON_BASE + tab.icon + ')';
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
