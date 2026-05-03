// sidebar.js — Right-side detail panel for buildings (files) and streets (directories).

import { getHue } from '../scene/colors.js';
import { DOM_IDS } from '../constants.js';
import { makeLucideIcon } from './icon.js';

// How long the "Copied!" badge lingers after the copy button is clicked.
var COPY_FEEDBACK_DURATION_MS = 1500;

// Persistent width range (in px) for the right sidebar drag handle.
var SIDEBAR_MIN_WIDTH = 280;
var SIDEBAR_MAX_WIDTH_RATIO = 0.7;  // fraction of viewport width
var SIDEBAR_WIDTH_STORAGE_KEY = 'cc.fileSidebarWidth';

// Binary-unit thresholds for human-readable file size formatting.
var BYTES_PER_KB = 1024;
var BYTES_PER_MB = 1024 * 1024;

// Em-dash text fallback shown when a file/directory has no value for a
// stat (e.g. no creation date, no line count).
var MISSING_VALUE = '—';

// Display options for ISO-date formatting in the sidebar. Fixed structural
// choice — every date renders as "Apr 18, 2026".
var DATE_FORMAT_OPTIONS = {
  year:  'numeric',
  month: 'short',
  day:   'numeric'
};

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

  _clearContent(sidebar);
  _ensureResizeHandle(sidebar);
  _applyPersistedWidth(sidebar);

  // ---- Header: name + extension badge + close button -------------------------
  var header = document.createElement('div');
  header.className = 'sidebar-header';

  var closeBtn = document.createElement('button');
  closeBtn.className = 'sidebar-close';
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.appendChild(makeLucideIcon('x', { title: 'Close' }));
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
  _appendStatItem(statsGrid, 'Lines', String(file.lines != null ? file.lines : MISSING_VALUE));

  var hasGit = file.git && (file.git.created || file.git.modified);
  var createdDate   = (file.git && file.git.created)  || file.created  || null;
  var modifiedDate  = (file.git && file.git.modified) || file.modified || null;
  var dateSource    = hasGit ? 'git' : 'fs';

  _appendStatItem(statsGrid, 'Created', createdDate ? formatDate(createdDate) : '\u2014', dateSource);
  _appendStatItem(statsGrid, 'Modified', modifiedDate ? formatDate(modifiedDate) : '\u2014', dateSource);

  statsSection.appendChild(statsGrid);
  body.appendChild(statsSection);

  // ---- Preview section -------------------------------------------------------
  var previewSection = _makePreviewSection(file);
  if (previewSection) body.appendChild(previewSection);

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

  _clearContent(sidebar);
  _ensureResizeHandle(sidebar);
  _applyPersistedWidth(sidebar);

  // ---- Header: name + directory badge + close button -------------------------
  var header = document.createElement('div');
  header.className = 'sidebar-header';

  var closeBtn = document.createElement('button');
  closeBtn.className = 'sidebar-close';
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.appendChild(makeLucideIcon('x', { title: 'Close' }));
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
    }, COPY_FEEDBACK_DURATION_MS);
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
  if (bytes < BYTES_PER_KB) return bytes + ' B';
  if (bytes < BYTES_PER_MB) return (bytes / BYTES_PER_KB).toFixed(1) + ' KB';
  return (bytes / BYTES_PER_MB).toFixed(1) + ' MB';
}

/**
 * Format an ISO-8601 date string into a human-readable date.
 *
 * @param {string} isoString - e.g. "2026-04-18T10:30:00Z"
 * @returns {string} e.g. "Apr 18, 2026"
 */
function formatDate(isoString) {
  if (!isoString) return MISSING_VALUE;
  var d = new Date(isoString);
  if (isNaN(d.getTime())) return isoString;
  return d.toLocaleDateString('en-US', DATE_FORMAT_OPTIONS);
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

// ── Preview rendering ─────────────────────────────────────────────────────────
// Auto-load images/video/audio/PDF (browser handles streaming + memory).
// Auto-load text under TEXT_PREVIEW_MAX_BYTES; above that, show a size note.
// For unrecognised binary types, just show "Binary file".

var TEXT_PREVIEW_MAX_BYTES = 256 * 1024;

var IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico', '.avif'];
var VIDEO_EXTS = ['.mp4', '.webm', '.mov', '.ogv', '.m4v'];
var AUDIO_EXTS = ['.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a'];
var PDF_EXTS   = ['.pdf'];

function _previewKind(file) {
  var ext = (file.extension || '').toLowerCase();
  if (IMAGE_EXTS.indexOf(ext) !== -1) return 'image';
  if (VIDEO_EXTS.indexOf(ext) !== -1) return 'video';
  if (AUDIO_EXTS.indexOf(ext) !== -1) return 'audio';
  if (PDF_EXTS.indexOf(ext)   !== -1) return 'pdf';
  // Anything else: try as text. The Preview helper will swap to a "Binary"
  // notice if the response isn't decodable as UTF-8.
  return 'text';
}

function _fileApiUrl(file) {
  var p = file.fullPath || '';
  return '/api/file?path=' + encodeURIComponent(p);
}

function _makePreviewSection(file) {
  if (!file || !file.fullPath) return null;

  var section = document.createElement('div');
  section.className = 'sidebar-section sidebar-preview-section';

  var label = document.createElement('div');
  label.className = 'sidebar-section-label';
  label.textContent = 'Preview';
  section.appendChild(label);

  var body = document.createElement('div');
  body.className = 'sidebar-preview-body';
  section.appendChild(body);

  var url = _fileApiUrl(file);
  var kind = _previewKind(file);

  if (kind === 'image') {
    var img = document.createElement('img');
    img.className = 'sidebar-preview-image';
    img.src = url;
    img.alt = file.name || '';
    body.appendChild(img);
    return section;
  }

  if (kind === 'video') {
    var vid = document.createElement('video');
    vid.className = 'sidebar-preview-media';
    vid.src = url;
    vid.controls = true;
    body.appendChild(vid);
    return section;
  }

  if (kind === 'audio') {
    var aud = document.createElement('audio');
    aud.className = 'sidebar-preview-media';
    aud.src = url;
    aud.controls = true;
    body.appendChild(aud);
    return section;
  }

  if (kind === 'pdf') {
    var emb = document.createElement('embed');
    emb.className = 'sidebar-preview-pdf';
    emb.type = 'application/pdf';
    emb.src = url;
    body.appendChild(emb);
    return section;
  }

  // Text: skip the fetch entirely if the file is too big.
  var size = typeof file.size === 'number' ? file.size : null;
  if (size != null && size > TEXT_PREVIEW_MAX_BYTES) {
    var note = document.createElement('div');
    note.className = 'sidebar-preview-note';
    note.textContent = 'File too large to preview (' + formatBytes(size) + ').';
    body.appendChild(note);
    return section;
  }

  var pre = document.createElement('pre');
  pre.className = 'sidebar-preview-text';
  var code = document.createElement('code');
  code.textContent = 'Loading…';
  pre.appendChild(code);
  body.appendChild(pre);

  fetch(url).then(function (resp) {
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    var ctype = resp.headers.get('Content-Type') || '';
    // If the server tagged it as image/audio/etc. without an extension we
    // recognised, swap to a "binary" note instead of dumping bytes.
    if (!/^text\/|json|xml|javascript|yaml|toml/i.test(ctype)) {
      throw new Error('binary');
    }
    return resp.text();
  }).then(function (text) {
    code.textContent = text;
  }).catch(function (err) {
    code.textContent = err && err.message === 'binary'
      ? 'Binary file — preview not available.'
      : 'Failed to load preview: ' + (err && err.message);
  });

  return section;
}

// ── Resize handle ─────────────────────────────────────────────────────────────
// Mirrors leftSidebar.js's pattern: a thin invisible drag-strip on the
// inside edge (LEFT here, RIGHT for the left sidebar). Width is clamped to
// [SIDEBAR_MIN_WIDTH, 70vw] and persisted in localStorage.

function _clearContent(sidebar) {
  // Keep .sidebar-resize-handle-right across content swaps so we don't have
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
  handle.addEventListener('pointerdown', function (e) {
    dragging = true;
    handle.classList.add('dragging');
    handle.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  handle.addEventListener('pointermove', function (e) {
    if (!dragging) return;
    // Cursor X measured from viewport left → sidebar width is what's to the
    // right of the cursor.
    var w = window.innerWidth - e.clientX;
    var maxW = Math.floor(window.innerWidth * SIDEBAR_MAX_WIDTH_RATIO);
    if (w < SIDEBAR_MIN_WIDTH) w = SIDEBAR_MIN_WIDTH;
    if (w > maxW)              w = maxW;
    sidebar.style.width = w + 'px';
  });
  handle.addEventListener('pointerup', function (e) {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    handle.releasePointerCapture(e.pointerId);
    _persistWidth(parseFloat(sidebar.style.width) || sidebar.offsetWidth);
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
    sidebar.style.width = w + 'px';
  } catch (_) { /* private mode / no storage — fall back to CSS default */ }
}

function _persistWidth(w) {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(w)); }
  catch (_) { /* drop */ }
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
