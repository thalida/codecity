// views/FilePreviewPane.tsx — body content for the right sidebar.
// Renders a file preview (image, video, audio, pdf, or syntax-highlighted
// code) for whatever file the coordinator pushes in via the state signal.
// Falls back to an empty-state hint when no file is pushed (or when a
// directory is selected — directories aren't previewable here).
//
// The pane renders a `.editor-body` body declaratively via JSX. It owns
// nothing about the sidebar shell (resize, open/close, persisted width) —
// that's layout/RightSidebar.tsx.

import type { ReadonlySignal } from '@preact/signals';
import { useState, useEffect } from 'preact/hooks';
import hljs from 'highlight.js/lib/common';
import { STREETS, BUILDINGS } from '@/state/stores/settings';
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
import { FileWarning, FileX, Info, MousePointerClick } from 'lucide-preact';
import { Pane, PaneEmpty } from '@/components/Pane';
import { KEY_BINDINGS } from '@/constants';
import { ExtensionBadge } from '@/components/Badge';
import { formatBytes } from '@/utils/bytes';
import { languageFor } from '@/utils/syntaxLanguages';

// Auto-load images/video/audio/PDF (browser handles streaming + memory).
// Auto-load text up to the server's own ceiling — kept in sync with
// MAX_FILE_BYTES in api/server.py so any file the API can serve, the
// preview can render. Above that, the server itself rejects the fetch
// and the preview shows the resulting error in the empty/error state.
const TEXT_PREVIEW_MAX_BYTES = 100 * 1024 * 1024;

// Big files render in graceful-degradation tiers so the browser stays
// responsive: above HIGHLIGHT_MAX_BYTES we skip highlight.js (plain
// text via {text}, no HTML-parse cost), above GUTTER_MAX_BYTES we
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
  state: ReadonlySignal<FilePreviewPaneState>;
  onClose?: () => void;
  onFocus?: (file: FileNode) => void;
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

// ── Text/code preview sub-component ──────────────────────────────────────────

// Discriminant for the lazy-fetched text body — mirrors CommitPane's
// loading → text → error state machine.
enum TextStateKind {
  Loading = 'loading',
  Text = 'text',
  Error = 'error',
}

type TextState =
  | { kind: TextStateKind.Loading }
  | { kind: TextStateKind.Text; text: string }
  | { kind: TextStateKind.Error; message: string };

interface FileTextPreviewProps {
  file: FileNode;
}

/**
 * Async-fetches a file's bytes and renders the code editor (or an error
 * state) inside a `.preview-shell`. Built this way (instead of mounting an
 * empty editor scaffold up-front) so the line-number gutter and
 * <pre><code> never linger empty next to an error message.
 */
function FileTextPreview({ file }: FileTextPreviewProps) {
  const [textState, setTextState] = useState<TextState>({ kind: TextStateKind.Loading });

  useEffect(() => {
    setTextState({ kind: TextStateKind.Loading });
    let cancelled = false;
    fetchFileText(file.fullPath || '').then(
      (text) => {
        if (cancelled) return;
        setTextState({ kind: TextStateKind.Text, text });
      },
      (err) => {
        if (cancelled) return;
        setTextState({
          kind: TextStateKind.Error,
          message: err && err.message ? err.message : 'Unknown error',
        });
      }
    );
    return () => { cancelled = true; };
    // Key on fullPath: a live-update poll yields a fresh FileNode with the
    // same path but changed content, and re-selecting it must re-fetch.
  }, [file.fullPath]);

  return (
    <div class="pane preview-shell">
      {textState.kind === TextStateKind.Error ? (
        <PaneEmpty
          icon={FileWarning}
          title="Couldn't load this file"
          sub={textState.message}
        />
      ) : textState.kind === TextStateKind.Text ? (
        <CodeEditor text={textState.text} file={file} />
      ) : null}
    </div>
  );
}

interface CodeEditorProps {
  text: string;
  file: FileNode;
}

function CodeEditor({ text, file }: CodeEditorProps) {
  // Byte count for tier selection. file.size is the authoritative byte
  // count from the manifest; fall back to text.length (UTF-16 code
  // units, close enough for ASCII-heavy source) when missing.
  const sizeBytes = typeof file.size === 'number' ? file.size : text.length;
  const skipHighlight = sizeBytes > HIGHLIGHT_MAX_BYTES;
  const skipGutter = sizeBytes > GUTTER_MAX_BYTES;

  // Line-number gutter: one <span> per source line. Counted off the raw
  // text (NOT the highlighted HTML — newlines are preserved through the
  // highlighter).
  const lineCount = skipGutter
    ? 0
    : text.length === 0
      ? 1
      : text.split('\n').length - (text.endsWith('\n') ? 1 : 0) || 1;

  // Highlight HTML is the only thing rendered via dangerouslySetInnerHTML.
  let highlightHtml: string | null = null;
  if (!skipHighlight) {
    const lang = languageFor(file);
    try {
      if (lang && hljs.getLanguage(lang)) {
        highlightHtml = hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;
      } else {
        highlightHtml = hljs.highlightAuto(text).value;
      }
    } catch (_) {
      // Highlighter blew up — leave highlightHtml null so the render
      // falls back to the plain (JSX-escaped) text branch below.
    }
  }

  const sizeLabel = formatBytes(sizeBytes);
  const bannerText = skipGutter
    ? `Plain text mode — file is ${sizeLabel}, line numbers and syntax colors are off to keep things responsive.`
    : `Plain text mode — file is ${sizeLabel}, syntax colors are off to keep things responsive.`;

  return (
    <div class="code-editor-shell">
      {(skipHighlight || skipGutter) && (
        <div class="code-editor-banner">
          <Info class="lucide-icon" />
          <span>{bannerText}</span>
        </div>
      )}
      <div class="code-editor">
        {!skipGutter && (
          <div class="code-editor-gutter">
            {Array.from({ length: lineCount }, (_, i) => (
              <span key={i} class="code-editor-ln">{i + 1}</span>
            ))}
          </div>
        )}
        <pre class="code-editor-pre">
          {highlightHtml === null ? (
            // skipHighlight, or the highlighter threw — render plain text;
            // JSX escapes it automatically (no manual escapeHtml needed).
            <code class="code-editor-code">{text}</code>
          ) : (
            <code
              class="code-editor-code hljs"
              dangerouslySetInnerHTML={{ __html: highlightHtml }}
            />
          )}
        </pre>
      </div>
    </div>
  );
}

// ── Body content ─────────────────────────────────────────────────────────────

function _previewBody(file: FileNode | null) {
  if (!file) {
    return (
      <PaneEmpty
        icon={MousePointerClick}
        title="Nothing to preview"
        sub="Select a file in the city to inspect it here."
      />
    );
  }
  if (!file.fullPath) return null;

  const url = fileUrl(file.fullPath || '');
  const kind = _previewKind(file);

  if (kind === PreviewKind.Image) {
    return <img class="preview-image" src={url} alt={file.name || ''} />;
  }
  if (kind === PreviewKind.Video) {
    return <video class="preview-media" src={url} controls />;
  }
  if (kind === PreviewKind.Audio) {
    return <audio class="preview-media" src={url} controls />;
  }
  if (kind === PreviewKind.Pdf) {
    return <embed class="preview-pdf" type="application/pdf" src={url} />;
  }

  // Text path: skip the fetch entirely if the file is too big.
  const size = typeof file.size === 'number' ? file.size : null;
  if (size != null && size > TEXT_PREVIEW_MAX_BYTES) {
    return (
      <PaneEmpty
        icon={FileX}
        title="File too large to preview"
        sub={`Cap is ${formatBytes(TEXT_PREVIEW_MAX_BYTES)} — this file is ${formatBytes(size)}.`}
      />
    );
  }

  // Keyed on fullPath so switching files remounts the fetch state machine.
  return <FileTextPreview key={file.fullPath} file={file} />;
}

// ── Preact component ─────────────────────────────────────────────────────────

export function FilePreviewPane({ state, onClose, onFocus }: FilePreviewPaneProps) {
  const { file } = state.value;
  const huePalette = BUILDINGS.value.HUE_EXT_MAP || {};
  const asphaltColor = STREETS.value.ASPHALT_COLOR;

  const leaf = file
    ? ((file.path ?? '').split('/').filter(Boolean).pop() || file.name || 'No file')
    : 'No file';

  const badge = file ? (
    <ExtensionBadge
      extension={file.extension ?? null}
      isDir={false}
      huePalette={huePalette}
      asphaltColor={asphaltColor}
    />
  ) : undefined;

  return (
    <Pane
      titleSlot={<span title={file?.path || undefined}>{leaf}</span>}
      mono
      prefixSlot={badge}
      onFocus={file && typeof onFocus === 'function' ? () => onFocus(file) : undefined}
      focusTitle={`Focus the camera on this file (${KEY_BINDINGS.FOCUS_SELECTION.label})`}
      onClose={onClose}
      bodyClass="editor-body"
    >
      {_previewBody(file)}
    </Pane>
  );
}
