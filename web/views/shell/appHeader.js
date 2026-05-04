// views/shell/appHeader.js — Sitewide top header. Owns the
// current-selection display (chip + clickable breadcrumb + copy-path
// button) and the two show/hide-sidebar toggles. Visibility state is
// persisted in localStorage so the preference survives reloads.

import { getHue } from '../../scene/colors.js';
import { makeLucideIcon } from './icon.js';

var STORAGE_LEFT  = 'cc.appLeftHidden';
var STORAGE_RIGHT = 'cc.appRightHidden';

// How long the "Copied!" badge lingers after the copy button is clicked.
var COPY_FEEDBACK_DURATION_MS = 1500;

/**
 * Initialise the sitewide header. Renders icons into the existing toggle
 * buttons in index.html, populates the title slot with chip + breadcrumb
 * + copy widgets, restores persisted visibility from localStorage.
 *
 * @param {Object} [opts]
 * @param {Object}   [opts.huePalette]    extension → hue map for the chip color
 * @param {string}   [opts.rootLabel]     project name shown as the leftmost
 *   breadcrumb segment (clicking it selects the project root)
 * @param {string}   [opts.rootPath]      the path string the segment-click
 *   handler should receive when the root is clicked (e.g. "." or "")
 * @param {Function} [opts.onSegmentClick] fn(path:string) — fires when the
 *   user clicks a breadcrumb segment. Caller selects the matching node.
 * @param {Function} [opts.onLeftToggle]   fn(hidden:boolean)
 * @param {Function} [opts.onRightToggle]  fn(hidden:boolean)
 */
export function initAppHeader(opts) {
  opts = opts || {};
  var huePalette     = opts.huePalette     || {};
  var rootLabel      = opts.rootLabel      || '';
  var rootPath       = opts.rootPath       || '';
  var onSegmentClick = typeof opts.onSegmentClick === 'function' ? opts.onSegmentClick : null;
  var onRightToggle  = typeof opts.onRightToggle  === 'function' ? opts.onRightToggle  : null;
  var onLeftToggle   = typeof opts.onLeftToggle   === 'function' ? opts.onLeftToggle   : null;

  var leftBtn  = document.getElementById('toggle-left-sidebar');
  var rightBtn = document.getElementById('toggle-right-sidebar');
  var titleEl  = document.getElementById('app-title');
  if (!leftBtn || !rightBtn || !titleEl) {
    return { setSelection: function () {}, setLeftVisible: function () {},
             setRightVisible: function () {}, isLeftVisible: function () { return true; },
             isRightVisible: function () { return true; } };
  }

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

  /**
   * Render the title slot for a selection.
   *
   * sel shape:
   *   null                                   → just the root segment (the
   *                                            project name) with a dir chip
   *   { path, extension, isDir }             → chip + breadcrumb + copy
   *
   * The breadcrumb is always prefixed by the root segment (clickable —
   * fires onSegmentClick with rootPath). When sel is null we show only
   * the root.
   */
  function setSelection(sel) {
    titleEl.replaceChildren();
    var hasSel = !!(sel && sel.path && sel.path !== rootPath);

    // Chip mirrors the leaf: file-ext when a file is selected, dir badge
    // for the root or any directory selection.
    if (hasSel && !sel.isDir) {
      titleEl.appendChild(_makeChip(sel.extension, false));
    } else {
      titleEl.appendChild(_makeChip(null, true));
    }

    var crumbs = document.createElement('div');
    crumbs.className = 'app-header-crumbs';
    crumbs.title = hasSel ? (rootLabel + '/' + sel.path) : rootLabel;

    // Always lead with the root.
    crumbs.appendChild(_makeSegment(rootLabel || '/', rootPath, !hasSel));

    if (hasSel) {
      var segs = sel.path.split('/').filter(Boolean);
      var acc = '';
      for (var i = 0; i < segs.length; i++) {
        acc = acc ? (acc + '/' + segs[i]) : segs[i];
        var isLeaf = (i === segs.length - 1);
        var sep = document.createElement('span');
        sep.className = 'app-header-sep';
        sep.textContent = '›';
        crumbs.appendChild(sep);
        crumbs.appendChild(_makeSegment(segs[i], acc, isLeaf));
      }
    }
    titleEl.appendChild(crumbs);

    if (hasSel) {
      // Copy button copies the absolute filesystem path so users can
      // paste it into a terminal / editor; the breadcrumb display
      // stays project-relative for readability.
      titleEl.appendChild(_makeCopyButton(sel.fullPath || sel.path));
    }
  }

  function _makeChip(extension, isDir) {
    var chip = document.createElement('span');
    chip.className = 'app-header-chip';
    if (isDir) {
      chip.classList.add('is-dir');
      chip.textContent = 'dir';
    } else {
      chip.textContent = (extension || '').replace(/^\./, '').slice(0, 4) || 'file';
      chip.style.setProperty('--badge-hue', getHue(extension, huePalette));
    }
    return chip;
  }

  function _makeSegment(label, path, isLeaf) {
    var seg = document.createElement('button');
    seg.type = 'button';
    seg.className = 'app-header-segment';
    if (isLeaf) seg.classList.add('is-leaf');
    seg.textContent = label;
    seg.addEventListener('click', function () {
      if (onSegmentClick) onSegmentClick(path);
    });
    return seg;
  }

  function _makeCopyButton(path) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'app-header-icon';
    btn.title = 'Copy path';
    btn.setAttribute('aria-label', 'Copy path');
    btn.appendChild(makeLucideIcon('copy'));
    btn.addEventListener('click', function () { _copy(path, btn); });
    return btn;
  }

  return {
    setSelection: setSelection,
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

function _copy(text, btn) {
  function flash() {
    if (!btn) return;
    btn.classList.add('is-copied');
    setTimeout(function () { btn.classList.remove('is-copied'); }, COPY_FEEDBACK_DURATION_MS);
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(flash, function () { _legacyCopy(text); flash(); });
  } else {
    _legacyCopy(text); flash();
  }
}

function _legacyCopy(text) {
  var ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.focus(); ta.select();
  try { document.execCommand('copy'); } catch (_) { /* fallback unavailable */ }
  document.body.removeChild(ta);
}
