// sidebar.js — Right-side preview pane. The pane has no header chrome of
// its own (chip + breadcrumb + copy live in the sitewide app header) — it
// renders just the preview body and a small status bar.

import hljs from 'highlight.js/lib/common';
import { DOM_IDS } from '../constants.js';
import { makeLucideIcon } from './icon.js';

// Persistent width range (in px) for the right sidebar drag handle.
var SIDEBAR_MIN_WIDTH = 280;
var SIDEBAR_MAX_WIDTH_RATIO = 0.7;  // fraction of viewport width
var SIDEBAR_WIDTH_STORAGE_KEY = 'cc.fileSidebarWidth';

// Binary-unit thresholds for human-readable file size formatting.
var BYTES_PER_KB = 1024;
var BYTES_PER_MB = 1024 * 1024;


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
  sidebar.classList.add('open');

  // The right sidebar is purely a preview pane now \u2014 chip / breadcrumb /
  // copy live in the sitewide header; status (language \u00b7 lines \u00b7 size \u00b7 \u2026)
  // lives in the sitewide footer. No per-pane chrome here.
  var body = document.createElement('div');
  body.className = 'editor-body';
  var previewSection = _makePreviewSection(file);
  if (previewSection) body.appendChild(previewSection);
  sidebar.appendChild(body);
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
export function showDirSidebar(_dir) {
  // Directories aren't previewable — the right pane is a file viewer.
  // Render the empty-state hint so the panel still has *something* to
  // look at when a dir is selected. The dir's metadata lives in the
  // sitewide header (chip + breadcrumb) and the global footer.
  showEmptySidebar();
}

/**
 * Close the sidebar. Fires the registered close handler so the caller can
 * clean up linked state (e.g. scene-level selection visuals).
 */
/**
 * Hide the sidebar (remove the .open class so it collapses to width 0).
 * Pure DOM mutation; does not fire any callback. Use this when the host
 * has already decided the sidebar should be hidden (e.g. after the user
 * toggles visibility off via the sitewide header).
 */
export function hideSidebar() {
  var sidebar = document.getElementById(DOM_IDS.FILE_SIDEBAR);
  if (sidebar) sidebar.classList.remove('open');
}

/**
 * Fire the close-button event. The sidebar's X button is a request from
 * the user to dismiss the panel — it doesn't directly mutate the DOM
 * here because main.js owns visibility state. Main's close handler will
 * call hideSidebar (or whatever else) in response.
 */
export function closeSidebar() {
  if (_onClose) _onClose();
}

/**
 * Open the sidebar with an empty-state placeholder. Used when the user
 * shows the sidebar via the sitewide header toggle but nothing is
 * currently selected.
 */
export function showEmptySidebar() {
  var sidebar = document.getElementById(DOM_IDS.FILE_SIDEBAR);
  if (!sidebar) return;

  _clearContent(sidebar);
  _ensureResizeHandle(sidebar);
  _applyPersistedWidth(sidebar);
  sidebar.classList.add('open');

  // Same shape as the preview's error / "too large" state — one helper,
  // one set of styles for every "centered icon + headline + subtitle"
  // moment in the panel.
  var body = document.createElement('div');
  body.className = 'editor-body';
  body.appendChild(_makeStateMessage(
    'mouse-pointer-click',
    'Nothing to preview',
    'Select a file in the city to inspect it here.'
  ));
  sidebar.appendChild(body);
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

// ── Language detection (used by both the syntax highlighter and the
//    sitewide footer's language label) ───────────────────────────────────────

/**
 * Map a file node to a human-readable language label. Used by the
 * sitewide footer too — exported so callers don't have to duplicate
 * the EXT_LANG / NAME_LANG inference.
 */
export function humanLanguageFor(file) {
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
    return _makeStateMessage(
      'file-x',
      'File too large to preview',
      'Cap is ' + formatBytes(TEXT_PREVIEW_MAX_BYTES) +
        ' — this file is ' + formatBytes(size) + '.'
    );
  }

  // A shell that swaps content based on fetch outcome — code editor on
  // success, error state on failure. Built this way (instead of mounting
  // an empty editor scaffold up-front) so the line-number gutter and
  // <pre><code> never linger empty next to an error message.
  var shell = document.createElement('div');
  shell.className = 'preview-shell';

  fetch(url).then(function (resp) {
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    return resp.text();
  }).then(function (text) {
    shell.replaceChildren(_buildCodeEditor(text, file));
  }).catch(function (err) {
    shell.replaceChildren(_makeStateMessage(
      'file-warning',
      'Couldn’t load this file',
      (err && err.message) ? err.message : 'Unknown error'
    ));
  });

  return shell;
}

/**
 * Centered icon + headline + subtitle. Used for the "file too large",
 * "couldn't load this file", and (via showEmptySidebar) "select a file"
 * states. Same shape as .editor-empty-hint.
 */
function _makeStateMessage(iconName, title, subtitle) {
  var box = document.createElement('div');
  box.className = 'preview-state';
  box.appendChild(makeLucideIcon(iconName));
  var h = document.createElement('p');
  h.className = 'preview-state-title';
  h.textContent = title;
  box.appendChild(h);
  if (subtitle) {
    var sub = document.createElement('p');
    sub.className = 'preview-state-sub';
    sub.textContent = subtitle;
    box.appendChild(sub);
  }
  return box;
}

function _buildCodeEditor(text, file) {
  var editor = document.createElement('div');
  editor.className = 'code-editor';

  var gutter = document.createElement('div');
  gutter.className = 'code-editor-gutter';

  var pre = document.createElement('pre');
  pre.className = 'code-editor-pre';
  var code = document.createElement('code');
  code.className = 'code-editor-code';
  pre.appendChild(code);

  editor.appendChild(gutter);
  editor.appendChild(pre);

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
  code.innerHTML = html;
  code.classList.add('hljs');

  // Line-number gutter: one <span> per source line. textContent counts
  // work off the raw text (NOT the highlighted HTML — newlines are
  // preserved through the highlighter).
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
  gutter.appendChild(frag);

  return editor;
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
  var liveWidth = 0;  // tracked across pointermove so we can persist on up

  handle.addEventListener('pointerdown', function (e) {
    dragging = true;
    handle.classList.add('dragging');
    handle.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  handle.addEventListener('pointermove', function (e) {
    if (!dragging) return;
    var w = window.innerWidth - e.clientX;
    var maxW = Math.floor(window.innerWidth * SIDEBAR_MAX_WIDTH_RATIO);
    if (w < SIDEBAR_MIN_WIDTH) w = SIDEBAR_MIN_WIDTH;
    if (w > maxW)              w = maxW;
    liveWidth = w;
    // Drive width via the CSS variable so the open/close rule
    // `width: var(--sidebar-width)` keeps working without an inline width
    // override fighting the .open/.is-animating transitions.
    sidebar.style.setProperty('--sidebar-width', w + 'px');
  });
  handle.addEventListener('pointerup', function (e) {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    handle.releasePointerCapture(e.pointerId);
    _persistWidth(liveWidth || sidebar.offsetWidth);
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
    sidebar.style.setProperty('--sidebar-width', w + 'px');
  } catch (_) { /* private mode / no storage — fall back to CSS default */ }
}

function _persistWidth(w) {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(w)); }
  catch (_) { /* drop */ }
}
