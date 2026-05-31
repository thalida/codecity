// views/panes/filePreviewPane.tsx — body content for the right sidebar.
// Renders a file preview (image, video, audio, pdf, or syntax-highlighted
// code) for whatever file the coordinator pushes in via setFile(). Falls
// back to an empty-state hint when no file is pushed (or when a directory
// is selected — directories aren't previewable here).
//
// The pane element this builder returns is a `.editor-body` div ready to
// be mounted into the right sidebar's slot. It owns nothing about the
// sidebar shell (resize, open/close, persisted width) — that's
// views/shell/rightSidebar.ts.

import type { Signal } from '@preact/signals';
import { effect } from '@preact/signals';
import hljs from 'highlight.js/lib/common';
import { ASPHALT, BUILDING_PALETTE } from '@/state/settings';
import { PreviewKind } from '@/types';
import type { FileNode } from '@/types';
import { fileUrl, fetchFileText } from '@/api/file';
import { makeLucideIcon } from '@/views/components/icon';
import { buildPaneHeader } from '@/views/components/paneHeader';
import { makeExtensionBadge } from '@/views/components/badge';

// Binary-unit thresholds for human-readable file size formatting.
const BYTES_PER_KB = 1024;
const BYTES_PER_MB = 1024 * 1024;

// Auto-load images/video/audio/PDF (browser handles streaming + memory).
// Auto-load text up to the server's own ceiling — kept in sync with
// MAX_FILE_BYTES in api/server.py so any file the API can serve, the
// preview can render. Above that, the server itself rejects the fetch
// and the preview shows the resulting error in the empty/error state.
const TEXT_PREVIEW_MAX_BYTES = 100 * 1024 * 1024;

// Big files render in graceful-degradation tiers so the browser stays
// responsive: above HIGHLIGHT_MAX_BYTES we skip highlight.js (plain
// text via textContent, no HTML-parse cost), above GUTTER_MAX_BYTES we
// also skip the per-line gutter (the O(n) DOM cost of one <span> per
// line is what hangs the page on multi-MB files). Tuned to keep
// main-thread blocking under ~250ms on commodity hardware.
const HIGHLIGHT_MAX_BYTES = 512 * 1024;
const GUTTER_MAX_BYTES = 1 * 1024 * 1024;

const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico', '.avif'];
const VIDEO_EXTS = ['.mp4', '.webm', '.mov', '.ogv', '.m4v'];
const AUDIO_EXTS = ['.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a'];
const PDF_EXTS = ['.pdf'];

// hljs language hints by extension. Falls through to auto-detection if a
// file doesn't match anything here. Matches the languages bundled in
// highlight.js/lib/common (~37 langs).
const EXT_LANG: Record<string, string> = {
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.jsx': 'javascript',
  '.py': 'python',
  '.rb': 'ruby',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.kt': 'kotlin',
  '.swift': 'swift',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.hpp': 'cpp',
  '.cc': 'cpp',
  '.cs': 'csharp',
  '.php': 'php',
  '.sh': 'bash',
  '.bash': 'bash',
  '.zsh': 'bash',
  '.fish': 'shell',
  '.html': 'xml',
  '.htm': 'xml',
  '.xml': 'xml',
  '.css': 'css',
  '.scss': 'scss',
  '.less': 'less',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'ini',
  '.ini': 'ini',
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.sql': 'sql',
  '.dockerfile': 'dockerfile',
  '.diff': 'diff',
  '.patch': 'diff',
  '.lua': 'lua',
  '.r': 'r',
  '.pl': 'perl',
  '.scala': 'scala',
};

// Filename-only hints (no extension or special-cased). Lower-cased keys.
const NAME_LANG: Record<string, string> = {
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  gnumakefile: 'makefile',
  '.gitignore': 'plaintext',
  '.gitattributes': 'plaintext',
  '.dockerignore': 'plaintext',
  '.npmignore': 'plaintext',
  '.editorconfig': 'ini',
  '.env': 'bash',
  license: 'plaintext',
  readme: 'markdown',
};

interface BuildFilePreviewPaneOpts {
  /** Called when the user clicks the x in the pane header. Host should
   *  hide the sidebar AND update any shell-level visibility tracker so a
   *  subsequent re-open isn't suppressed. */
  onClose?: () => void;
  /** Called when the user clicks the focus button in the pane header.
   *  Equivalent of pressing F on the canvas with the current file selected
   *  — host should frame the camera on the currently-previewed file. The
   *  callback receives the file the pane is currently showing (so the host
   *  doesn't have to read from picker state). */
  onFocus?: (file: FileNode) => void;
}

// ── State shape for Preact component ─────────────────────────────────────────

export interface FilePreviewPaneState {
  file: FileNode | null;
}

export interface FilePreviewPaneProps {
  state: Signal<FilePreviewPaneState>;
  onClose?: () => void;
  onFocus?: (file: FileNode) => void;
}

// ── Preact component ─────────────────────────────────────────────────────────

export function FilePreviewPane({ state, onClose, onFocus }: FilePreviewPaneProps) {
  const { file } = state.value;
  const huePalette = BUILDING_PALETTE.value.HUE_EXT_MAP || {};
  const asphaltColor = ASPHALT.value.COLOR;

  const leaf = file
    ? ((file.path ?? '').split('/').filter(Boolean).pop() || file.name || 'No file')
    : 'No file';

  return (
    <div class="pane">
      <div class="pane-header">
        {file && typeof onFocus === 'function' && (
          <button
            type="button"
            class="btn-icon btn-icon--text"
            title="Focus the camera on this file (F)"
            aria-label="Focus the camera on this file (F)"
            onClick={() => onFocus(file)}
          />
        )}
        {file && (
          <span
            dangerouslySetInnerHTML={{
              __html: makeExtensionBadge(file.extension ?? null, false, huePalette, asphaltColor).outerHTML,
            }}
          />
        )}
        <h3 class="text-pane-title is-mono" title={file?.path || undefined}>{leaf}</h3>
        {typeof onClose === 'function' && (
          <button
            type="button"
            class="btn-icon btn-icon--text"
            title="Hide sidebar"
            aria-label="Hide sidebar"
            onClick={() => onClose()}
          />
        )}
      </div>
      <div class="pane editor-body">
        {!file ? (
          <div class="empty-state empty-state--lg">
            <p class="text-card-title">Nothing to preview</p>
            <p class="text-card-sub">Select a file in the city to inspect it here.</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ── Backward-compat factory ───────────────────────────────────────────────────
/**
 * Build a file-preview pane.
 *
 * Returns:
 *   pane — outer container `<div class="file-preview-pane">` to mount
 *     into the right sidebar slot. Contains a `.pane-header` (leaf
 *     filename + x close button) and a `.editor-body` that holds the
 *     actual preview content.
 *   api.setFile(file | null) — push the file the pane should render. Pass
 *     null to show the "nothing to preview" empty state (used both for
 *     no-selection and for directory-selection, since dirs aren't
 *     previewable in this pane). The header title updates in lockstep.
 */
export function buildFilePreviewPane(opts: BuildFilePreviewPaneOpts = {}) {
  const pane = document.createElement('div');
  pane.className = 'pane';

  const { el: header, api: headerApi } = buildPaneHeader({
    title: 'No file',
    mono: true,
    onClose: opts.onClose,
    onFocus: opts.onFocus
      ? () => {
          if (_activeFile) opts.onFocus!(_activeFile);
        }
      : undefined,
    focusTitle: 'Focus the camera on this file (F)',
  });
  pane.appendChild(header);

  const body = document.createElement('div');
  body.className = 'pane editor-body';
  pane.appendChild(body);

  // Track the active file so palette/asphalt changes can re-render the badge.
  let _activeFile: FileNode | null = null;

  function _renderBadge(): void {
    if (!_activeFile) {
      headerApi.setPrefixEl(null);
      return;
    }
    // Use .value to read signals (Phase 3a migration)
    const huePalette = BUILDING_PALETTE.value.HUE_EXT_MAP || {};
    const asphaltColor = ASPHALT.value.COLOR;
    headerApi.setPrefixEl(
      makeExtensionBadge(_activeFile.extension ?? null, false, huePalette, asphaltColor)
    );
  }

  /** Render just the leaf filename in the pane-title element. The full
   *  path lives in the header breadcrumb (sitewide app header); the
   *  sidebar header stays compact. Hovering the title shows the full
   *  path as a native browser tooltip. */
  function _renderFilenameTitle(file: { path?: string; name?: string } | null): void {
    const rawPath = (file as FileNode | null)?.path ?? '';
    const segs = rawPath.split('/').filter(Boolean);
    const leaf =
      segs.length > 0 ? segs[segs.length - 1] : file?.name ? String(file.name) : 'No file';
    headerApi.setTitle(leaf);
    if (rawPath) headerApi.titleEl.title = rawPath;
    else headerApi.titleEl.removeAttribute('title');
  }

  // Re-render badge when palette or asphalt color changes mid-session.
  // Drop the initial synchronous callback at subscribe time (same pattern
  // as appHeader) — _ready gates it until after first setFile().
  let _ready = false;
  const _onConfigChange = () => {
    if (_ready) _renderBadge();
  };
  effect(() => { void BUILDING_PALETTE.value; _onConfigChange(); });
  effect(() => { void ASPHALT.value; _onConfigChange(); });
  _ready = true;

  function setFile(
    file:
      | FileNode
      | {
          name?: string;
          extension?: string;
          fullPath?: string;
          size?: number;
          [k: string]: unknown;
        }
      | null
  ): void {
    _activeFile = file as FileNode | null;
    _renderFilenameTitle(file as FileNode | null);
    _renderBadge();
    headerApi.setFocusEnabled(!!_activeFile);
    body.replaceChildren();
    if (!file) {
      body.appendChild(
        _makeStateMessage(
          'mouse-pointer-click',
          'Nothing to preview',
          'Select a file in the city to inspect it here.'
        )
      );
      return;
    }
    const section = _makePreviewSection(file as FileNode);
    if (section) body.appendChild(section);
  }

  setFile(null);

  return {
    pane,
    api: { setFile },
  };
}

/**
 * Map a file node to a human-readable language label. Used by the
 * sitewide footer too — exported so callers don't have to duplicate
 * the EXT_LANG / NAME_LANG inference.
 */
export function humanLanguageFor(file: FileNode): string {
  const key = _languageFor(file);
  if (!key) {
    if (file.extension) return file.extension.replace(/^\./, '').toUpperCase();
    return 'Plain Text';
  }
  // Map hljs internal id -> display name.
  const labels: Record<string, string> = {
    javascript: 'JavaScript',
    typescript: 'TypeScript',
    python: 'Python',
    ruby: 'Ruby',
    go: 'Go',
    rust: 'Rust',
    java: 'Java',
    kotlin: 'Kotlin',
    swift: 'Swift',
    c: 'C',
    cpp: 'C++',
    csharp: 'C#',
    php: 'PHP',
    bash: 'Shell',
    shell: 'Shell',
    xml: 'HTML',
    css: 'CSS',
    scss: 'SCSS',
    less: 'Less',
    json: 'JSON',
    yaml: 'YAML',
    ini: 'INI',
    markdown: 'Markdown',
    sql: 'SQL',
    dockerfile: 'Dockerfile',
    diff: 'Diff',
    lua: 'Lua',
    r: 'R',
    perl: 'Perl',
    scala: 'Scala',
    plaintext: 'Plain Text',
    makefile: 'Makefile',
  };
  return labels[key] || key;
}

/**
 * Format a byte count into a human-readable string. e.g. "512 B", "3.4 KB", "1.2 MB"
 */
function formatBytes(bytes: number): string {
  if (bytes < BYTES_PER_KB) return `${bytes} B`;
  if (bytes < BYTES_PER_MB) return `${(bytes / BYTES_PER_KB).toFixed(1)} KB`;
  return `${(bytes / BYTES_PER_MB).toFixed(1)} MB`;
}

function _previewKind(file: FileNode | { extension?: string }): PreviewKind {
  const ext = (file.extension || '').toLowerCase();
  if (IMAGE_EXTS.includes(ext)) return PreviewKind.Image;
  if (VIDEO_EXTS.includes(ext)) return PreviewKind.Video;
  if (AUDIO_EXTS.includes(ext)) return PreviewKind.Audio;
  if (PDF_EXTS.includes(ext)) return PreviewKind.Pdf;
  // Anything else: try as text. The Preview helper will swap to a "Binary"
  // notice if the response isn't decodable as UTF-8.
  return PreviewKind.Text;
}

// _fileApiUrl removed — callers use fileUrl() / fetchFileText() from api/file.ts.

function _makePreviewSection(file: FileNode | null): HTMLElement | null {
  if (!file || !file.fullPath) return null;

  const url = fileUrl(file.fullPath || '');
  const kind = _previewKind(file);

  if (kind === PreviewKind.Image) {
    const img = document.createElement('img');
    img.className = 'preview-image';
    img.src = url;
    img.alt = file.name || '';
    return img;
  }

  if (kind === PreviewKind.Video) {
    const vid = document.createElement('video');
    vid.className = 'preview-media';
    vid.src = url;
    vid.controls = true;
    return vid;
  }

  if (kind === PreviewKind.Audio) {
    const aud = document.createElement('audio');
    aud.className = 'preview-media';
    aud.src = url;
    aud.controls = true;
    return aud;
  }

  if (kind === PreviewKind.Pdf) {
    const emb = document.createElement('embed');
    emb.className = 'preview-pdf';
    emb.type = 'application/pdf';
    emb.src = url;
    return emb;
  }

  // Text path: skip the fetch entirely if the file is too big.
  const size = typeof file.size === 'number' ? file.size : null;
  if (size != null && size > TEXT_PREVIEW_MAX_BYTES) {
    return _makeStateMessage(
      'file-x',
      'File too large to preview',
      `Cap is ${formatBytes(TEXT_PREVIEW_MAX_BYTES)} — this file is ${formatBytes(size)}.`
    );
  }

  // A shell that swaps content based on fetch outcome — code editor on
  // success, error state on failure. Built this way (instead of mounting
  // an empty editor scaffold up-front) so the line-number gutter and
  // <pre><code> never linger empty next to an error message.
  const shell = document.createElement('div');
  shell.className = 'pane preview-shell';

  fetchFileText(file.fullPath || '')
    .then(
      (text) =>
        new Promise<void>((resolve) => {
          // Defer the synchronous DOM build to the next animation frame
          // so the browser can paint the empty .preview-shell first.
          // Without this, on a big file the click-to-render cycle blocks
          // the main thread end-to-end and the click visibly "freezes".
          requestAnimationFrame(() => {
            shell.replaceChildren(_buildCodeEditor(text, file));
            resolve();
          });
        })
    )
    .catch((err) => {
      shell.replaceChildren(
        _makeStateMessage(
          'file-warning',
          "Couldn't load this file",
          err && err.message ? err.message : 'Unknown error'
        )
      );
    });

  return shell;
}

/**
 * Centered icon + headline + subtitle. Used for the "file too large",
 * "couldn't load this file", and "select a file" empty states. Same
 * shape as .editor-empty-hint.
 */
function _makeStateMessage(iconName: string, title: string, subtitle?: string): HTMLElement {
  const box = document.createElement('div');
  box.className = 'empty-state empty-state--lg';
  box.appendChild(makeLucideIcon(iconName));
  const h = document.createElement('p');
  h.className = 'text-card-title';
  h.textContent = title;
  box.appendChild(h);
  if (subtitle) {
    const sub = document.createElement('p');
    sub.className = 'text-card-sub';
    sub.textContent = subtitle;
    box.appendChild(sub);
  }
  return box;
}

function _buildCodeEditor(text: string, file: FileNode): HTMLElement {
  // Byte count for tier selection. file.size is the authoritative byte
  // count from the manifest; fall back to text.length (UTF-16 code
  // units, close enough for ASCII-heavy source) when missing.
  const sizeBytes = typeof file.size === 'number' ? file.size : text.length;
  const skipHighlight = sizeBytes > HIGHLIGHT_MAX_BYTES;
  const skipGutter = sizeBytes > GUTTER_MAX_BYTES;

  // The outer shell stacks an optional degradation banner above the
  // editor — when present, it tells the user why colors / line numbers
  // are missing.
  const shell = document.createElement('div');
  shell.className = 'code-editor-shell';

  if (skipHighlight || skipGutter) {
    shell.appendChild(_makeDegradationBanner(sizeBytes, skipGutter));
  }

  const editor = document.createElement('div');
  editor.className = 'code-editor';

  const pre = document.createElement('pre');
  pre.className = 'code-editor-pre';
  const code = document.createElement('code');
  code.className = 'code-editor-code';
  pre.appendChild(code);

  if (!skipGutter) {
    const gutter = document.createElement('div');
    gutter.className = 'code-editor-gutter';
    // Line-number gutter: one <span> per source line. textContent counts
    // work off the raw text (NOT the highlighted HTML — newlines are
    // preserved through the highlighter).
    const lineCount =
      text.length === 0 ? 1 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0) || 1;
    const frag = document.createDocumentFragment();
    for (let i = 1; i <= lineCount; i++) {
      const ln = document.createElement('span');
      ln.className = 'code-editor-ln';
      ln.textContent = String(i);
      frag.appendChild(ln);
    }
    gutter.appendChild(frag);
    editor.appendChild(gutter);
  }

  editor.appendChild(pre);

  if (skipHighlight) {
    // Plain text via textContent — skips both the regex escape pass and
    // the HTML parser the browser would otherwise run on a multi-MB
    // innerHTML string. This is the difference between a 5-10 second
    // freeze and a near-instant render on big files.
    code.textContent = text;
  } else {
    const lang = _languageFor(file);
    let html: string;
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
  }

  shell.appendChild(editor);
  return shell;
}

function _makeDegradationBanner(sizeBytes: number, gutterSkipped: boolean): HTMLElement {
  const banner = document.createElement('div');
  banner.className = 'code-editor-banner';
  banner.appendChild(makeLucideIcon('info'));
  const msg = document.createElement('span');
  const sizeLabel = formatBytes(sizeBytes);
  msg.textContent = gutterSkipped
    ? `Plain text mode — file is ${sizeLabel}, line numbers and syntax colors are off to keep things responsive.`
    : `Plain text mode — file is ${sizeLabel}, syntax colors are off to keep things responsive.`;
  banner.appendChild(msg);
  return banner;
}

function _languageFor(file: { extension?: string; name?: string }): string | null {
  const ext = (file.extension || '').toLowerCase();
  if (ext && EXT_LANG[ext]) return EXT_LANG[ext];
  const name = (file.name || '').toLowerCase();
  if (NAME_LANG[name]) return NAME_LANG[name];
  return null;
}

function _escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
