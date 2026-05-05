// views/panes/filePreviewPane.js — body content for the right sidebar.
// Renders a file preview (image, video, audio, pdf, or syntax-highlighted
// code) for whatever file the coordinator pushes in via setFile(). Falls
// back to an empty-state hint when no file is pushed (or when a directory
// is selected — directories aren't previewable here).
//
// The pane element this builder returns is a `.editor-body` div ready to
// be mounted into the right sidebar's slot. It owns nothing about the
// sidebar shell (resize, open/close, persisted width) — that's
// views/shell/rightSidebar.js.

import hljs from 'highlight.js/lib/common';
import { PreviewKind } from '@/types';
import type { FileNode } from '@/types';
import { makeLucideIcon } from '@/views/shell/icon.js';

// Binary-unit thresholds for human-readable file size formatting.
const BYTES_PER_KB = 1024;
const BYTES_PER_MB = 1024 * 1024;

// Auto-load images/video/audio/PDF (browser handles streaming + memory).
// Auto-load text under TEXT_PREVIEW_MAX_BYTES; above that, show a size note.
// For unrecognised binary types, just show "Binary file".
const TEXT_PREVIEW_MAX_BYTES = 256 * 1024;

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

/**
 * Build a file-preview pane.
 *
 * Returns:
 *   pane — `<div class="editor-body">` to mount into the right sidebar slot
 *   api.setFile(file | null) — push the file the pane should render. Pass
 *     null to show the "nothing to preview" empty state (used both for
 *     no-selection and for directory-selection, since dirs aren't
 *     previewable in this pane).
 */
export function buildFilePreviewPane() {
  const body = document.createElement('div');
  body.className = 'editor-body';

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
    pane: body,
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
  // Map hljs internal id → display name.
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

function _fileApiUrl(file: FileNode): string {
  const p = file.fullPath || '';
  return `/api/file?path=${encodeURIComponent(p)}`;
}

function _makePreviewSection(file: FileNode | null): HTMLElement | null {
  if (!file || !file.fullPath) return null;

  const url = _fileApiUrl(file);
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
  shell.className = 'preview-shell';

  fetch(url)
    .then((resp) => {
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return resp.text();
    })
    .then((text) => {
      shell.replaceChildren(_buildCodeEditor(text, file));
    })
    .catch((err) => {
      shell.replaceChildren(
        _makeStateMessage(
          'file-warning',
          'Couldn’t load this file',
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
  box.className = 'preview-state';
  box.appendChild(makeLucideIcon(iconName));
  const h = document.createElement('p');
  h.className = 'preview-state-title';
  h.textContent = title;
  box.appendChild(h);
  if (subtitle) {
    const sub = document.createElement('p');
    sub.className = 'preview-state-sub';
    sub.textContent = subtitle;
    box.appendChild(sub);
  }
  return box;
}

function _buildCodeEditor(text: string, file: FileNode): HTMLElement {
  const editor = document.createElement('div');
  editor.className = 'code-editor';

  const gutter = document.createElement('div');
  gutter.className = 'code-editor-gutter';

  const pre = document.createElement('pre');
  pre.className = 'code-editor-pre';
  const code = document.createElement('code');
  code.className = 'code-editor-code';
  pre.appendChild(code);

  editor.appendChild(gutter);
  editor.appendChild(pre);

  // Pick the language hint up-front; fall back to hljs auto-detect.
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

  return editor;
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
