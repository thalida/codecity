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
import { useEffect, useRef } from 'preact/hooks';
import hljs from 'highlight.js/lib/common';
import { ASPHALT, BUILDING_PALETTE } from '@/state/settings';
import type { FileNode } from '@/types';

/**
 * What kind of preview a file gets in the right sidebar. Decided by
 * extension; 'text' is the catch-all (rendered with syntax highlighting,
 * or "Binary file" if the bytes don't decode as UTF-8).
 */
export enum PreviewKind {
  Image = 'image',
  Video = 'video',
  Audio = 'audio',
  Pdf = 'pdf',
  Text = 'text',
}
import { fileUrl, fetchFileText } from '@/api/file';
import { makeLucideIcon } from '@/views/components/LucideIcon';
import { Pane } from '@/views/components/Pane';
import { makeExtensionBadge } from '@/views/components/Badge';
import { formatBytes } from '@/utils/bytes';
import { escapeHtml } from '@/utils/html';
import { languageFor } from '@/utils/syntaxLanguages';

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

  // The preview body (image / video / audio / pdf / syntax-highlighted code)
  // is built imperatively because the code path produces highlight.js HTML
  // and async-streamed content. Pane owns the .editor-body element via
  // bodyRef but renders no JSX children into it, so replaceChildren() is safe.
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = bodyRef.current;
    if (!host) return;
    host.replaceChildren();
    if (!file) {
      host.appendChild(
        _makeStateMessage(
          'mouse-pointer-click',
          'Nothing to preview',
          'Select a file in the city to inspect it here.'
        )
      );
      return;
    }
    const section = _makePreviewSection(file);
    if (section) host.appendChild(section);
  }, [file?.fullPath, file?.path]);

  const badge = file ? (
    <span
      dangerouslySetInnerHTML={{
        __html: makeExtensionBadge(file.extension ?? null, false, huePalette, asphaltColor).outerHTML,
      }}
    />
  ) : undefined;

  return (
    <Pane
      titleSlot={<span title={file?.path || undefined}>{leaf}</span>}
      mono
      prefixSlot={badge}
      onFocus={file && typeof onFocus === 'function' ? () => onFocus(file) : undefined}
      focusTitle="Focus the camera on this file (F)"
      onClose={onClose}
      bodyClass="editor-body"
      bodyRef={bodyRef}
    />
  );
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
    const lang = languageFor(file);
    let html: string;
    try {
      if (lang && hljs.getLanguage(lang)) {
        html = hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;
      } else {
        html = hljs.highlightAuto(text).value;
      }
    } catch (_) {
      // Highlighter blew up — fall back to plain escaped text.
      html = escapeHtml(text);
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

