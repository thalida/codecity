// sidebar.js — Right-side detail panel for buildings (files) and streets (directories).

import { getHue } from '../scene/colors.js';
import {
  GLYPHS,
  UI_TIMING,
  BYTE_FORMATTING,
  DATE_FORMAT_OPTIONS
} from '../config/index.js';
import { DOM_IDS } from '../constants.js';

// Palette injected from main.js (config.building.hue_ext_map). Empty object
// means "no palette configured" — getHue will fall back to its hash.
var _huePalette = {};

// Optional handler invoked AFTER closeSidebar runs. main.js wires this to
// clear scene-level selection state (outlines, sidewalk tints) so any path
// that closes the sidebar — close button, Esc, click-empty — also clears
// the selection visuals automatically.
var _onClose = null;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Inject the extension→hue palette so badge colors match the building palette
 * configured in defaults.js.
 *
 * @param {Object} palette - Map of extension → hue (e.g. { ".ts": 215 }).
 */
export function setSidebarPalette(palette) {
  _huePalette = palette || {};
}

/**
 * Register a callback to fire whenever the sidebar closes. Used by main.js
 * to clear scene-level selection state in lockstep with the sidebar.
 *
 * @param {Function} fn - Callback. Pass null to clear.
 */
export function setSidebarCloseHandler(fn) {
  _onClose = fn || null;
}

/**
 * Show the sidebar populated with metadata for a file node.
 *
 * Expected file shape (from scan.sh manifest):
 *   name, path, fullPath, extension, size, lines, created, modified,
 *   git: { created, modified } | null
 *
 * @param {Object} file - File node from the scanner manifest.
 */
export function showFileSidebar(file) {
  var sidebar = document.getElementById(DOM_IDS.FILE_SIDEBAR);
  if (!sidebar) return;

  // Clear previous content
  while (sidebar.firstChild) {
    sidebar.removeChild(sidebar.firstChild);
  }

  // ---- Header: name + extension badge + close button -------------------------
  var header = document.createElement('div');
  header.className = 'sidebar-header';

  var closeBtn = document.createElement('button');
  closeBtn.className = 'sidebar-close';
  closeBtn.type = 'button';
  closeBtn.textContent = GLYPHS.get().CLOSE_BUTTON;
  closeBtn.addEventListener('click', closeSidebar);
  header.appendChild(closeBtn);

  var titleRow = document.createElement('div');
  titleRow.className = 'sidebar-title-row';

  var nameEl = document.createElement('h2');
  nameEl.className = 'sidebar-title';
  nameEl.textContent = file.name || '';
  titleRow.appendChild(nameEl);

  if (file.extension) {
    var badge = document.createElement('span');
    badge.className = 'ext-badge';
    badge.textContent = file.extension;

    var hue = getHue(file.extension, _huePalette);
    // Set the per-file hue as a CSS custom property; saturation +
    // lightness for bg/text/border live in styles.css `.ext-badge`.
    badge.style.setProperty('--badge-hue', hue);
    titleRow.appendChild(badge);
  }

  header.appendChild(titleRow);

  // Path row inside header
  var pathRow = _makePathRow(file.path || file.fullPath || '');
  header.appendChild(pathRow);

  sidebar.appendChild(header);

  // ---- Scrollable body -------------------------------------------------------
  var body = document.createElement('div');
  body.className = 'sidebar-body';

  // ---- Stats section ---------------------------------------------------------
  var statsSection = document.createElement('div');
  statsSection.className = 'sidebar-section';

  var statsLabel = document.createElement('div');
  statsLabel.className = 'sidebar-section-label';
  statsLabel.textContent = 'Stats';
  statsSection.appendChild(statsLabel);

  var statsGrid = document.createElement('div');
  statsGrid.className = 'sidebar-stats';

  _appendStatItem(statsGrid, 'Size', formatBytes(file.size || 0));
  _appendStatItem(statsGrid, 'Lines', String(file.lines != null ? file.lines : GLYPHS.get().MISSING_VALUE));

  var hasGit = file.git && (file.git.created || file.git.modified);
  var createdDate   = (file.git && file.git.created)  || file.created  || null;
  var modifiedDate  = (file.git && file.git.modified) || file.modified || null;
  var dateSource    = hasGit ? 'git' : 'fs';

  _appendStatItem(statsGrid, 'Created', createdDate ? formatDate(createdDate) : '\u2014', dateSource);
  _appendStatItem(statsGrid, 'Modified', modifiedDate ? formatDate(modifiedDate) : '\u2014', dateSource);

  statsSection.appendChild(statsGrid);
  body.appendChild(statsSection);

  sidebar.appendChild(body);

  // ---- Slide in --------------------------------------------------------------
  sidebar.classList.add('open');
}

/**
 * Show the sidebar populated with metadata for a directory node.
 *
 * Expected directory shape (from scan.sh manifest):
 *   name, path, fullPath,
 *   children_count, children_file_count, children_dir_count,
 *   descendants_count, descendants_file_count, descendants_dir_count,
 *   descendants_size
 *
 * @param {Object} dir - Directory node from the scanner manifest.
 */
export function showDirSidebar(dir) {
  var sidebar = document.getElementById(DOM_IDS.FILE_SIDEBAR);
  if (!sidebar) return;

  // Clear previous content
  while (sidebar.firstChild) {
    sidebar.removeChild(sidebar.firstChild);
  }

  // ---- Header: name + directory badge + close button -------------------------
  var header = document.createElement('div');
  header.className = 'sidebar-header';

  var closeBtn = document.createElement('button');
  closeBtn.className = 'sidebar-close';
  closeBtn.type = 'button';
  closeBtn.textContent = GLYPHS.get().CLOSE_BUTTON;
  closeBtn.addEventListener('click', closeSidebar);
  header.appendChild(closeBtn);

  var titleRow = document.createElement('div');
  titleRow.className = 'sidebar-title-row';

  var nameEl = document.createElement('h2');
  nameEl.className = 'sidebar-title';
  nameEl.textContent = dir.name || '';
  titleRow.appendChild(nameEl);

  var badge = document.createElement('span');
  badge.className = 'dir-badge';
  badge.textContent = 'directory';
  titleRow.appendChild(badge);

  header.appendChild(titleRow);

  // Path row inside header
  var pathRow = _makePathRow(dir.path || dir.fullPath || '');
  header.appendChild(pathRow);

  sidebar.appendChild(header);

  // ---- Scrollable body -------------------------------------------------------
  var body = document.createElement('div');
  body.className = 'sidebar-body';

  // ---- Children section ------------------------------------------------------
  var childSection = document.createElement('div');
  childSection.className = 'sidebar-section';

  var childLabel = document.createElement('div');
  childLabel.className = 'sidebar-section-label';
  childLabel.textContent = 'Children';
  childSection.appendChild(childLabel);

  var childGrid = document.createElement('div');
  childGrid.className = 'sidebar-stats';

  _appendStatItem(childGrid, 'Total', String(dir.children_count || 0));
  _appendStatItem(childGrid, 'Files', String(dir.children_file_count || 0));
  _appendStatItem(childGrid, 'Dirs', String(dir.children_dir_count || 0));

  childSection.appendChild(childGrid);
  body.appendChild(childSection);

  // ---- Descendants section ---------------------------------------------------
  var descSection = document.createElement('div');
  descSection.className = 'sidebar-section';

  var descLabel = document.createElement('div');
  descLabel.className = 'sidebar-section-label';
  descLabel.textContent = 'Descendants';
  descSection.appendChild(descLabel);

  var descGrid = document.createElement('div');
  descGrid.className = 'sidebar-stats';

  _appendStatItem(descGrid, 'Total', String(dir.descendants_count || 0));
  _appendStatItem(descGrid, 'Files', String(dir.descendants_file_count || 0));
  _appendStatItem(descGrid, 'Dirs', String(dir.descendants_dir_count || 0));
  _appendStatItem(descGrid, 'Total Size', formatBytes(dir.descendants_size || 0));

  descSection.appendChild(descGrid);
  body.appendChild(descSection);

  sidebar.appendChild(body);

  // ---- Slide in --------------------------------------------------------------
  sidebar.classList.add('open');
}

/**
 * Close the sidebar. Fires the registered close handler so the caller can
 * clean up linked state (e.g. scene-level selection visuals).
 */
export function closeSidebar() {
  var sidebar = document.getElementById(DOM_IDS.FILE_SIDEBAR);
  if (sidebar) {
    sidebar.classList.remove('open');
  }
  if (_onClose) _onClose();
}

/**
 * Copy text to the clipboard with a brief visual confirmation on the trigger button.
 *
 * Uses navigator.clipboard (modern) with fallback to the legacy execCommand API
 * for environments that don't support the Clipboard API (e.g. non-HTTPS, older browsers).
 *
 * @param {string} text    - The text to copy.
 * @param {Element} button - The button element that triggered the copy action.
 */
function copyToClipboard(text, button) {
  function showFeedback() {
    if (!button) return;
    var original = button.textContent;
    button.textContent = 'Copied!';
    setTimeout(function () {
      button.textContent = original;
    }, UI_TIMING.get().COPY_FEEDBACK_DURATION_MS);
  }

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(showFeedback, function () {
      _legacyCopy(text);
      showFeedback();
    });
  } else {
    _legacyCopy(text);
    showFeedback();
  }
}

/**
 * Format a byte count into a human-readable string.
 *
 * @param {number} bytes
 * @returns {string} e.g. "512 B", "3.4 KB", "1.2 MB"
 */
function formatBytes(bytes) {
  var t = BYTE_FORMATTING.get();
  if (bytes < t.KB_THRESHOLD) {
    return bytes + ' B';
  }
  if (bytes < t.MB_THRESHOLD) {
    return (bytes / t.KB_THRESHOLD).toFixed(1) + ' KB';
  }
  return (bytes / t.MB_THRESHOLD).toFixed(1) + ' MB';
}

/**
 * Format an ISO-8601 date string into a human-readable date.
 *
 * @param {string} isoString - e.g. "2026-04-18T10:30:00Z"
 * @returns {string} e.g. "Apr 18, 2026"
 */
function formatDate(isoString) {
  if (!isoString) return GLYPHS.get().MISSING_VALUE;
  var d = new Date(isoString);
  if (isNaN(d.getTime())) return isoString;
  return d.toLocaleDateString('en-US', DATE_FORMAT_OPTIONS.get());
}

// ── Private helpers ───────────────────────────────────────────────────────────

/**
 * Build a path row element: the path text + a copy button.
 *
 * @param {string} pathText
 * @returns {Element}
 */
function _makePathRow(pathText) {
  var row = document.createElement('div');
  row.className = 'sidebar-path-row';

  var pathEl = document.createElement('span');
  pathEl.className = 'sidebar-path';
  pathEl.textContent = pathText;
  row.appendChild(pathEl);

  var copyBtn = document.createElement('button');
  copyBtn.className = 'copy-btn';
  copyBtn.type = 'button';
  copyBtn.textContent = 'Copy';
  copyBtn.addEventListener('click', function () {
    copyToClipboard(pathText, copyBtn);
  });
  row.appendChild(copyBtn);

  return row;
}

function _appendStatItem(container, label, value, source) {
  var item = document.createElement('div');
  item.className = 'stat-item';

  var labelEl = document.createElement('span');
  labelEl.className = 'stat-label';
  labelEl.textContent = label;
  item.appendChild(labelEl);

  var valueEl = document.createElement('span');
  valueEl.className = 'stat-value';
  valueEl.textContent = value;

  if (source) {
    var sourceTag = document.createElement('span');
    sourceTag.className = 'stat-source';
    sourceTag.textContent = '(' + source + ')';
    valueEl.appendChild(sourceTag);
  }

  item.appendChild(valueEl);
  container.appendChild(item);
}

function _legacyCopy(text) {
  var ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.top = '0';
  ta.style.left = '0';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try {
    document.execCommand('copy');
  } catch (e) {
    // Silent fallback — nothing we can do without clipboard access
  }
  document.body.removeChild(ta);
}
