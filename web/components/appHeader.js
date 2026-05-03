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
 * sidebar component uses to push the current selection title.
 */
export function initAppHeader() {
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

  var leftHidden  = _loadFlag(STORAGE_LEFT);
  var rightHidden = _loadFlag(STORAGE_RIGHT);
  document.body.classList.toggle('left-hidden',  leftHidden);
  document.body.classList.toggle('right-hidden', rightHidden);
  _renderLeftIcon(leftHidden);
  _renderRightIcon(rightHidden);

  leftBtn.addEventListener('click', function () {
    leftHidden = !leftHidden;
    document.body.classList.toggle('left-hidden', leftHidden);
    _renderLeftIcon(leftHidden);
    _saveFlag(STORAGE_LEFT, leftHidden);
  });
  rightBtn.addEventListener('click', function () {
    rightHidden = !rightHidden;
    document.body.classList.toggle('right-hidden', rightHidden);
    _renderRightIcon(rightHidden);
    _saveFlag(STORAGE_RIGHT, rightHidden);
  });

  return {
    setTitle: function (text) {
      titleEl.textContent = text || '';
    },
  };
}

function _loadFlag(key) {
  try {
    return localStorage.getItem(key) === '1';
  } catch (_) {
    return false;
  }
}

function _saveFlag(key, on) {
  try {
    if (on) localStorage.setItem(key, '1');
    else    localStorage.removeItem(key);
  } catch (_) { /* private mode — drop */ }
}
