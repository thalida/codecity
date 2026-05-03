// sidebar.js — Right-side detail panel for buildings (files) and streets (directories).

import hljs from 'highlight.js/lib/common';
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

  // Tab bar \u2014 name + ext chip + close. Like a single open editor tab.
  var extChip = file.extension ? _makeExtChip(file.extension) : null;
  sidebar.appendChild(_makeTabBar(file.name || '', extChip));

  // Breadcrumb under the tab.
  sidebar.appendChild(_makeBreadcrumb(file.path || file.fullPath || ''));

  // Editor body \u2014 the preview fills the panel.
  var body = document.createElement('div');
  body.className = 'editor-body';
  var previewSection = _makePreviewSection(file);
  if (previewSection) body.appendChild(previewSection);
  sidebar.appendChild(body);

  // Status bar \u2014 file metadata as VSCode-style chips.
  sidebar.appendChild(_makeFileStatusBar(file));

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

  sidebar.appendChild(_makeTabBar(dir.name || '', _makeDirChip()));
  sidebar.appendChild(_makeBreadcrumb(dir.path || dir.fullPath || ''));

  // Body: a compact info panel — directories don't have an editor view.
  var body = document.createElement('div');
  body.className = 'editor-body editor-body-info';
  body.appendChild(_makeDirInfoPanel(dir));
  sidebar.appendChild(body);

  sidebar.appendChild(_makeDirStatusBar(dir));

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

// ── IDE chrome (tab bar / breadcrumb / status bar) ────────────────────────────

/**
 * Single editor tab: filename, optional ext-color chip, close button.
 */
function _makeTabBar(name, chipEl) {
  var bar = document.createElement('div');
  bar.className = 'editor-tab-bar';

  var tab = document.createElement('div');
  tab.className = 'editor-tab is-active';

  if (chipEl) tab.appendChild(chipEl);

  var nameEl = document.createElement('span');
  nameEl.className = 'editor-tab-name';
  nameEl.textContent = name;
  nameEl.title = name;  // long names get truncated; tooltip restores them
  tab.appendChild(nameEl);

  var closeBtn = document.createElement('button');
  closeBtn.className = 'editor-tab-close';
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.appendChild(makeLucideIcon('x', { title: 'Close' }));
  closeBtn.addEventListener('click', closeSidebar);
  tab.appendChild(closeBtn);

  bar.appendChild(tab);
  return bar;
}

/**
 * Per-extension hue chip rendered inside the tab. Visually telegraphs
 * the file's language family without a dedicated icon set.
 */
function _makeExtChip(extension) {
  var chip = document.createElement('span');
  chip.className = 'editor-tab-chip';
  chip.textContent = (extension || '').replace(/^\./, '').slice(0, 4) || 'file';
  var hue = getHue(extension, _huePalette);
  chip.style.setProperty('--badge-hue', hue);
  return chip;
}

function _makeDirChip() {
  var chip = document.createElement('span');
  chip.className = 'editor-tab-chip editor-tab-chip-dir';
  chip.textContent = 'dir';
  return chip;
}

/**
 * Breadcrumb under the tab. Splits the path on / and renders each segment
 * as plain text joined by ›. Tail of the row holds a small Copy button.
 */
function _makeBreadcrumb(pathText) {
  var bar = document.createElement('div');
  bar.className = 'editor-breadcrumb';

  var segments = (pathText || '').split('/').filter(Boolean);
  if (segments.length === 0) {
    var none = document.createElement('span');
    none.className = 'editor-breadcrumb-segment';
    none.textContent = pathText || '/';
    bar.appendChild(none);
  } else {
    for (var i = 0; i < segments.length; i++) {
      var seg = document.createElement('span');
      seg.className = 'editor-breadcrumb-segment';
      if (i === segments.length - 1) seg.classList.add('is-leaf');
      seg.textContent = segments[i];
      bar.appendChild(seg);
      if (i < segments.length - 1) {
        var sep = document.createElement('span');
        sep.className = 'editor-breadcrumb-sep';
        sep.textContent = '›';
        bar.appendChild(sep);
      }
    }
  }

  var copyBtn = document.createElement('button');
  copyBtn.className = 'editor-breadcrumb-copy';
  copyBtn.type = 'button';
  copyBtn.title = 'Copy path';
  copyBtn.setAttribute('aria-label', 'Copy path');
  copyBtn.appendChild(makeLucideIcon('copy', { title: 'Copy path' }));
  copyBtn.addEventListener('click', function () {
    copyToClipboard(pathText, copyBtn);
  });
  bar.appendChild(copyBtn);

  return bar;
}

/**
 * Status bar — `language · 1234 lines · 33.7 KB · modified Apr 18 (git)`.
 * Mirrors VSCode's bottom bar but rendered per-file instead of global.
 */
function _makeFileStatusBar(file) {
  var bar = document.createElement('div');
  bar.className = 'editor-status-bar';

  var lang = _humanLanguageFor(file);
  if (lang) bar.appendChild(_statusItem(lang));

  if (file.lines != null) {
    bar.appendChild(_statusItem(String(file.lines) + ' lines'));
  }

  bar.appendChild(_statusItem(formatBytes(file.size || 0)));

  var hasGit = file.git && (file.git.created || file.git.modified);
  var modified = (file.git && file.git.modified) || file.modified || null;
  var created  = (file.git && file.git.created)  || file.created  || null;
  var src = hasGit ? 'git' : 'fs';
  if (modified) {
    bar.appendChild(_statusItem('modified ' + formatDate(modified), src));
  }
  if (created) {
    bar.appendChild(_statusItem('created ' + formatDate(created), src));
  }
  return bar;
}

function _makeDirStatusBar(dir) {
  var bar = document.createElement('div');
  bar.className = 'editor-status-bar';
  bar.appendChild(_statusItem('Directory'));
  bar.appendChild(_statusItem((dir.descendants_file_count || 0) + ' files'));
  bar.appendChild(_statusItem((dir.descendants_dir_count || 0) + ' dirs'));
  bar.appendChild(_statusItem(formatBytes(dir.descendants_size || 0)));
  return bar;
}

function _statusItem(text, source) {
  var item = document.createElement('span');
  item.className = 'editor-status-item';
  item.textContent = text;
  if (source) {
    var src = document.createElement('span');
    src.className = 'editor-status-source';
    src.textContent = '(' + source + ')';
    item.appendChild(src);
  }
  return item;
}

/**
 * Compact info body for directories — two pairs of stat rows shown
 * inline rather than the previous full-section grid. The status bar
 * already carries the high-level totals.
 */
function _makeDirInfoPanel(dir) {
  var panel = document.createElement('div');
  panel.className = 'dir-info';

  var rows = [
    ['Direct children',  String(dir.children_count       || 0)],
    ['  Files',          String(dir.children_file_count  || 0)],
    ['  Dirs',           String(dir.children_dir_count   || 0)],
    ['Recursive total',  String(dir.descendants_count    || 0)],
    ['  Files',          String(dir.descendants_file_count || 0)],
    ['  Dirs',           String(dir.descendants_dir_count  || 0)],
    ['  Size',           formatBytes(dir.descendants_size || 0)],
  ];

  for (var i = 0; i < rows.length; i++) {
    var row = document.createElement('div');
    row.className = 'dir-info-row';
    var k = document.createElement('span');
    k.className = 'dir-info-key';
    k.textContent = rows[i][0];
    var v = document.createElement('span');
    v.className = 'dir-info-value';
    v.textContent = rows[i][1];
    row.appendChild(k);
    row.appendChild(v);
    panel.appendChild(row);
  }
  return panel;
}

function _humanLanguageFor(file) {
  var key = _languageFor(file);
  if (!key) {
    if (file.extension) return file.extension.replace(/^\./, '').toUpperCase();
    return 'Plain Text';
  }
  // Map hljs internal id → display name.
  var labels = {
    javascript: 'JavaScript', typescript: 'TypeScript', python: 'Python',
    ruby: 'Ruby', go: 'Go', rust: 'Rust', java: 'Java', kotlin: 'Kotlin',
    swift: 'Swift', c: 'C', cpp: 'C++', csharp: 'C#', php: 'PHP',
    bash: 'Shell', shell: 'Shell', xml: 'HTML', css: 'CSS', scss: 'SCSS',
    less: 'Less', json: 'JSON', yaml: 'YAML', ini: 'INI',
    markdown: 'Markdown', sql: 'SQL', dockerfile: 'Dockerfile',
    diff: 'Diff', lua: 'Lua', r: 'R', perl: 'Perl', scala: 'Scala',
    plaintext: 'Plain Text', makefile: 'Makefile',
  };
  return labels[key] || key;
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

// hljs language hints by extension. Falls through to auto-detection if a
// file doesn't match anything here. Matches the languages bundled in
// highlight.js/lib/common (~37 langs).
var EXT_LANG = {
  '.js':   'javascript',  '.mjs':  'javascript',  '.cjs':  'javascript',
  '.ts':   'typescript',  '.tsx':  'typescript',  '.jsx':  'javascript',
  '.py':   'python',
  '.rb':   'ruby',
  '.go':   'go',
  '.rs':   'rust',
  '.java': 'java',
  '.kt':   'kotlin',
  '.swift':'swift',
  '.c':    'c',           '.h':    'c',
  '.cpp':  'cpp',         '.hpp':  'cpp',         '.cc':   'cpp',
  '.cs':   'csharp',
  '.php':  'php',
  '.sh':   'bash',        '.bash': 'bash',        '.zsh':  'bash',
  '.fish': 'shell',
  '.html': 'xml',         '.htm':  'xml',         '.xml':  'xml',
  '.css':  'css',         '.scss': 'scss',        '.less': 'less',
  '.json': 'json',
  '.yaml': 'yaml',        '.yml':  'yaml',
  '.toml': 'ini',
  '.ini':  'ini',
  '.md':   'markdown',    '.markdown': 'markdown',
  '.sql':  'sql',
  '.dockerfile': 'dockerfile',
  '.diff': 'diff',        '.patch': 'diff',
  '.lua':  'lua',
  '.r':    'r',
  '.pl':   'perl',
  '.scala':'scala',
};

// Filename-only hints (no extension or special-cased). Lower-cased keys.
var NAME_LANG = {
  'dockerfile':         'dockerfile',
  'makefile':           'makefile',
  'gnumakefile':        'makefile',
  '.gitignore':         'plaintext',
  '.gitattributes':     'plaintext',
  '.dockerignore':      'plaintext',
  '.npmignore':         'plaintext',
  '.editorconfig':      'ini',
  '.env':               'bash',
  'license':            'plaintext',
  'readme':             'markdown',
};

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

  var url = _fileApiUrl(file);
  var kind = _previewKind(file);

  if (kind === 'image') {
    var img = document.createElement('img');
    img.className = 'preview-image';
    img.src = url;
    img.alt = file.name || '';
    return img;
  }

  if (kind === 'video') {
    var vid = document.createElement('video');
    vid.className = 'preview-media';
    vid.src = url;
    vid.controls = true;
    return vid;
  }

  if (kind === 'audio') {
    var aud = document.createElement('audio');
    aud.className = 'preview-media';
    aud.src = url;
    aud.controls = true;
    return aud;
  }

  if (kind === 'pdf') {
    var emb = document.createElement('embed');
    emb.className = 'preview-pdf';
    emb.type = 'application/pdf';
    emb.src = url;
    return emb;
  }

  // Text path: skip the fetch entirely if the file is too big.
  var size = typeof file.size === 'number' ? file.size : null;
  if (size != null && size > TEXT_PREVIEW_MAX_BYTES) {
    var note = document.createElement('div');
    note.className = 'preview-note';
    note.textContent = 'File too large to preview (' + formatBytes(size) + ').';
    return note;
  }

  // Code-editor scaffold: gutter + <pre><code>. Both share the line-height
  // so gutter numbers line up with their source lines.
  var editor = document.createElement('div');
  editor.className = 'code-editor';

  var gutter = document.createElement('div');
  gutter.className = 'code-editor-gutter';

  var pre = document.createElement('pre');
  pre.className = 'code-editor-pre';
  var code = document.createElement('code');
  code.className = 'code-editor-code';
  code.textContent = 'Loading…';
  pre.appendChild(code);

  editor.appendChild(gutter);
  editor.appendChild(pre);

  fetch(url).then(function (resp) {
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    var ctype = resp.headers.get('Content-Type') || '';
    if (!/^text\/|json|xml|javascript|yaml|toml/i.test(ctype)) {
      throw new Error('binary');
    }
    return resp.text();
  }).then(function (text) {
    _renderCode(code, gutter, text, file);
  }).catch(function (err) {
    code.textContent = err && err.message === 'binary'
      ? 'Binary file — preview not available.'
      : 'Failed to load preview: ' + (err && err.message);
  });

  return editor;
}

function _renderCode(codeEl, gutterEl, text, file) {
  // Pick the language hint up-front; fall back to hljs auto-detect.
  var lang = _languageFor(file);
  var html;
  try {
    if (lang && hljs.getLanguage(lang)) {
      html = hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;
    } else {
      html = hljs.highlightAuto(text).value;
    }
  } catch (_) {
    // Highlighter blew up — fall back to plain escaped text.
    html = _escapeHtml(text);
  }
  codeEl.innerHTML = html;
  codeEl.classList.add('hljs');

  // Line-number gutter: one <span> per source line. textContent counts work
  // off the original raw text (NOT the highlighted HTML, which has injected
  // <span> tags but should preserve newlines).
  var lineCount = text.length === 0
    ? 1
    : (text.split('\n').length - (text.endsWith('\n') ? 1 : 0)) || 1;
  var frag = document.createDocumentFragment();
  for (var i = 1; i <= lineCount; i++) {
    var ln = document.createElement('span');
    ln.className = 'code-editor-ln';
    ln.textContent = String(i);
    frag.appendChild(ln);
  }
  gutterEl.appendChild(frag);
}

function _languageFor(file) {
  var ext = (file.extension || '').toLowerCase();
  if (ext && EXT_LANG[ext]) return EXT_LANG[ext];
  var name = (file.name || '').toLowerCase();
  if (NAME_LANG[name]) return NAME_LANG[name];
  return null;
}

function _escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
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
