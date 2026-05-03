// appHeader.js — Sitewide top header. Carries the current selection
// title and two toggles (show/hide left sidebar, show/hide right
// sidebar). Visibility state is persisted in localStorage so the
// preference survives reloads.

import { makeLucideIcon } from './icon.js';

var STORAGE_LEFT  = 'cc.appLeftHidden';
var STORAGE_RIGHT = 'cc.appRightHidden';

/**
 * Initialise the sitewide header. Adds Lucide icons to the existing
 * toggle buttons in index.html and wires their click handlers; restores
 * persisted hidden state from localStorage. Returns a small API the
 * caller uses to push the current selection title and to react to the
 * user toggling either sidebar.
 *
 * @param {Object} [opts]
 * @param {Function} [opts.onRightToggle]  fn(hidden:boolean) — fires after
 *   the user clicks the right-sidebar toggle. Caller can show an empty
 *   state when un-hiding with no current selection, etc.
 * @param {Function} [opts.onLeftToggle]   fn(hidden:boolean)
 */
export function initAppHeader(opts) {
  opts = opts || {};
  var onRightToggle = typeof opts.onRightToggle === 'function' ? opts.onRightToggle : null;
  var onLeftToggle  = typeof opts.onLeftToggle  === 'function' ? opts.onLeftToggle  : null;
  var leftBtn  = document.getElementById('toggle-left-sidebar');
  var rightBtn = document.getElementById('toggle-right-sidebar');
  var titleEl  = document.getElementById('app-title');
  if (!leftBtn || !rightBtn || !titleEl) {
    return { setTitle: function () {} };
  }

  // Initial icons match the current visibility — panel-left/right when
  // visible (clicking them hides), panel-left-open/right-open when
  // hidden (clicking restores).
  function _renderLeftIcon(hidden) {
    leftBtn.replaceChildren(
      makeLucideIcon(hidden ? 'panel-left-open' : 'panel-left-close')
    );
    leftBtn.title = hidden ? 'Show left sidebar' : 'Hide left sidebar';
  }
  function _renderRightIcon(hidden) {
    rightBtn.replaceChildren(
      makeLucideIcon(hidden ? 'panel-right-open' : 'panel-right-close')
    );
    rightBtn.title = hidden ? 'Show right sidebar' : 'Hide right sidebar';
  }

  // Both sidebars default to visible on first run. The right starts in
  // its empty state (no selection); the left starts on its tree pane.
  var leftHidden  = _loadFlag(STORAGE_LEFT,  false);
  var rightHidden = _loadFlag(STORAGE_RIGHT, false);
  document.body.classList.toggle('left-hidden',  leftHidden);
  document.body.classList.toggle('right-hidden', rightHidden);
  _renderLeftIcon(leftHidden);
  _renderRightIcon(rightHidden);

  leftBtn.addEventListener('click', function () {
    _setLeftHidden(!leftHidden);
    if (onLeftToggle) onLeftToggle(leftHidden);
  });
  rightBtn.addEventListener('click', function () {
    _setRightHidden(!rightHidden);
    if (onRightToggle) onRightToggle(rightHidden);
  });

  function _setLeftHidden(hidden) {
    leftHidden = hidden;
    document.body.classList.toggle('left-hidden', leftHidden);
    _renderLeftIcon(leftHidden);
    _saveFlag(STORAGE_LEFT, leftHidden);
  }
  function _setRightHidden(hidden) {
    rightHidden = hidden;
    document.body.classList.toggle('right-hidden', rightHidden);
    _renderRightIcon(rightHidden);
    _saveFlag(STORAGE_RIGHT, rightHidden);
  }

  return {
    setTitle: function (text) {
      titleEl.textContent = text || '';
    },
    // Programmatic visibility — used when the user clicks the X inside
    // the sidebar's own header so the sitewide button stays in sync.
    // Doesn't fire onLeftToggle / onRightToggle (caller already knows).
    setLeftVisible:  function (visible) { _setLeftHidden(!visible); },
    setRightVisible: function (visible) { _setRightHidden(!visible); },
    isLeftVisible:   function () { return !leftHidden;  },
    isRightVisible:  function () { return !rightHidden; },
  };
}

function _loadFlag(key, defaultVal) {
  try {
    var v = localStorage.getItem(key);
    if (v == null) return defaultVal;
    return v === '1';
  } catch (_) {
    return defaultVal;
  }
}

function _saveFlag(key, on) {
  try {
    if (on) localStorage.setItem(key, '1');
    else    localStorage.removeItem(key);
  } catch (_) { /* private mode — drop */ }
}
