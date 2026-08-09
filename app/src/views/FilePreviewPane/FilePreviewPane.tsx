// views/FilePreviewPane.tsx — body content for the right sidebar.
// Renders a file preview (image, video, audio, pdf, or syntax-highlighted
// code) for whatever file is selected via the state signal. Falls back to
// an empty-state hint when no file is selected (or when a directory is
// selected — directories aren't previewable here).
//
// The pane renders a `.editor-body` body declaratively via JSX. It owns
// nothing about the sidebar shell (resize, open/close, persisted width) —
// that's layout/RightSidebar.tsx.

import './FilePreviewPane.css';
import type { ReadonlySignal } from '@preact/signals';
import { useState, useEffect } from 'preact/hooks';
import hljs from 'highlight.js/lib/common';
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
  Font = 'font',
  Text = 'text',
}
import { fileUrl, fetchFileText, fetchFileBytes } from '@/api/file';
import { PaneStats } from '@/components/PaneStats/PaneStats';
import { fileStatItems } from '@/components/PaneStats/statItems';
import { scrubbedBlobShaFor } from '@/state/stores/presentPaths';
import { fetchFingerprintB64 } from '@/api/fingerprint';
import { IMAGE_EXTS, VIDEO_EXTS, AUDIO_EXTS, PDF_EXTS, FONT_EXTS } from '@/constants/fileKinds';
import { FileWarning, FileX, Info, MousePointerClick, LoaderCircle, Binary } from 'lucide-preact';
import { Pane, PaneEmpty } from '@/components/Pane';
import { KEY_BINDINGS } from '@/constants/keyboard';
import { PathBreadcrumbs } from '@/components/PathBreadcrumbs/PathBreadcrumbs';
import { nodeUrl } from '@/utils/commit';
import { formatBytes } from '@/utils/bytes';
import { formatFullDate } from '@/utils/dates';
import { languageFor } from '@/utils/syntaxLanguages';
import { isDataBuilding } from '@/utils/binaryKind';

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

// ── State shape for Preact component ─────────────────────────────────────────

export interface FilePreviewPaneState {
  file: FileNode | null;
  /** Repo label + root path, for the header path breadcrumb. */
  rootLabel?: string;
  rootPath?: string;
  /** Repo remote URL + branch, for the header open-on-origin link. */
  remoteUrl?: string | null;
  branch?: string;
  /** In Timeline mode the preview reads HEAD (the checkout), not the scrubbed
   *  commit — show a note saying so. */
  /** The file is deleted at HEAD (not in the checked-out tree), so /api/file
   *  would 404 — show a deleted state instead of fetching. */
  isDeleted?: boolean;
}

export interface FilePreviewPaneProps {
  state: ReadonlySignal<FilePreviewPaneState>;
  onClose?: () => void;
  onFocus?: (file: FileNode) => void;
  onExclude?: (file: FileNode) => void;
}

export function _previewKind(file: FileNode | { extension?: string }): PreviewKind {
  const ext = (file.extension || '').toLowerCase();
  if (IMAGE_EXTS.includes(ext)) return PreviewKind.Image;
  if (VIDEO_EXTS.includes(ext)) return PreviewKind.Video;
  if (AUDIO_EXTS.includes(ext)) return PreviewKind.Audio;
  if (PDF_EXTS.includes(ext)) return PreviewKind.Pdf;
  if (FONT_EXTS.includes(ext)) return PreviewKind.Font;
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
    fetchFileText(file.fullPath || '', file.modified, scrubbedBlobShaFor(file.path)).then(
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
    return () => {
      cancelled = true;
    };
    // Also key on modified (mtime): a live-update poll yields a fresh FileNode
    // with the same path but a newer mtime when the file was edited, so the
    // still-selected preview re-fetches instead of waiting for a re-select.
  }, [file.fullPath, file.modified, scrubbedBlobShaFor(file.path)]);

  return (
    <div class="pane preview-shell">
      {textState.kind === TextStateKind.Error ? (
        <PaneEmpty icon={FileWarning} title="Couldn't load this file" sub={textState.message} />
      ) : textState.kind === TextStateKind.Text ? (
        <CodeEditor text={textState.text} file={file} />
      ) : (
        // Visible loading state — big repos can take a beat to serve the bytes.
        <div class="empty-state empty-state--lg file-preview-loading" role="status">
          <LoaderCircle class="icon" aria-hidden="true" />
          <p class="text-card-sub">Loading file…</p>
        </div>
      )}
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
        <div class="code-editor-banner card-banner">
          <Info class="icon" />
          <span>{bannerText}</span>
        </div>
      )}
      <div class="code-editor surface-app">
        {!skipGutter && (
          <div class="code-editor-gutter">
            {Array.from({ length: lineCount }, (_, i) => (
              <span key={i} class="code-editor-ln">
                {i + 1}
              </span>
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

// ── Font specimen preview sub-component ──────────────────────────────────────

// Discriminant for the FontFace load — mirrors FileTextPreview's
// loading → ready → error state machine.
enum FontStateKind {
  Loading = 'loading',
  Ready = 'ready',
  Error = 'error',
}

type FontState =
  | { kind: FontStateKind.Loading }
  | { kind: FontStateKind.Ready }
  | { kind: FontStateKind.Error; message: string };

// Specimen content. The Preview block is a Google-Fonts-style waterfall
// (uppercase, lowercase, digits, then a pangram); the Repertoire block is a
// Font-Book-style grid of every glyph we render.
const SPECIMEN_UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const SPECIMEN_LOWER = 'abcdefghijklmnopqrstuvwxyz';
const SPECIMEN_DIGITS = '1234567890';
const SPECIMEN_PANGRAM = 'The quick brown fox jumps over the lazy dog';

// Repertoire: printable ASCII (skip 0x20 space — it's a blank cell) plus a
// curated run of common Latin-1 / extended glyphs, ligatures, and punctuation,
// mirroring a Font Book character grid. Glyphs the face lacks fall back to the
// browser's default font rather than being hidden — detecting true coverage
// needs font-table parsing this preview intentionally avoids.
const REPERTOIRE: string[] = [
  ...Array.from({ length: 0x7e - 0x21 + 1 }, (_, i) => String.fromCharCode(0x21 + i)),
  ...'¡¿€£¥¢©®™°±×÷§¶†‡–—…«»‹›“”‘’·•',
  ...'ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØŒÙÚÛÜÝÞ',
  ...'àáâãäåæçèéêëìíîïðñòóôõöøœùúûüýþÿ',
  ...'ﬁﬂßıŁłĐđ',
];

// Monotonic id so each mounted preview registers a distinct @font-face family;
// two files with the same basename must not collide on one document-level face.
let fontFamilySeq = 0;

// sfnt / WOFF signatures (first 4 bytes, big-endian) for the formats a browser
// can render via FontFace. We sniff these before handing bytes to FontFace so a
// non-font (a Git LFS pointer, a text file with a .ttf name) never reaches the
// decoder, which would otherwise log "Failed to decode downloaded font" to the
// console for every attempt.
const FONT_SIGNATURES = new Set([
  0x00010000, // TrueType outlines
  0x4f54544f, // 'OTTO' — OpenType with CFF outlines
  0x74727565, // 'true' — TrueType (legacy Mac)
  0x74797031, // 'typ1' — PostScript in an sfnt wrapper
  0x74746366, // 'ttcf' — TrueType/OpenType collection
  0x774f4646, // 'wOFF' — WOFF
  0x774f4632, // 'wOF2' — WOFF2
]);

/**
 * Decide whether a file's bytes are a font we can render. Returns null when
 * they are; otherwise a human-readable reason for the fallback notice. Catches
 * the common "font stored via Git LFS, not smudged on clone" case with a
 * specific message.
 */
function fontRejectReason(buf: ArrayBuffer): string | null {
  if (buf.byteLength < 4) return 'This file is empty or too small to be a font.';
  const signature = new DataView(buf).getUint32(0, false);
  if (FONT_SIGNATURES.has(signature)) return null;

  const head = new TextDecoder().decode(new Uint8Array(buf, 0, Math.min(48, buf.byteLength)));
  if (head.startsWith('version https://git-lfs')) {
    return 'This font is stored in Git LFS and its content could not be fetched (the LFS object may be missing, private, or over its bandwidth quota).';
  }
  return 'This file is not a recognized font (ttf, otf, woff, or woff2).';
}

interface FontPreviewProps {
  file: FileNode;
}

/**
 * Loads a font file through the FontFace API and renders a live specimen in
 * that face. The face is registered on document.fonts for the component's
 * lifetime and removed on unmount / file change, so switching files never
 * leaves orphaned faces behind. Parse failures fall back to a graceful notice
 * rather than dumping the binary bytes.
 */
function FontPreview({ file }: FontPreviewProps) {
  const [family] = useState(() => `cc-font-specimen-${(fontFamilySeq += 1)}`);
  const [fontState, setFontState] = useState<FontState>({ kind: FontStateKind.Loading });

  useEffect(() => {
    setFontState({ kind: FontStateKind.Loading });

    if (typeof FontFace === 'undefined' || typeof document.fonts === 'undefined') {
      setFontState({ kind: FontStateKind.Error, message: 'Font preview is unavailable here.' });
      return;
    }

    let cancelled = false;
    // Only faces we actually register get cleaned up, so a rejected load never
    // tries to delete a face that was never added.
    let added: FontFace | null = null;

    fetchFileBytes(file.fullPath || '', file.modified, scrubbedBlobShaFor(file.path)).then(
      async (buf) => {
        if (cancelled) return;
        const reason = fontRejectReason(buf);
        if (reason) {
          // Bail before FontFace so the browser never logs a decode error.
          setFontState({ kind: FontStateKind.Error, message: reason });
          return;
        }
        try {
          // Build from the bytes we already have (not a url()), so there's no
          // second network round trip.
          const loaded = await new FontFace(family, buf).load();
          if (cancelled) return;
          document.fonts.add(loaded);
          added = loaded;
          setFontState({ kind: FontStateKind.Ready });
        } catch {
          if (cancelled) return;
          setFontState({
            kind: FontStateKind.Error,
            message: 'This file could not be read as a font.',
          });
        }
      },
      (err) => {
        if (cancelled) return;
        setFontState({
          kind: FontStateKind.Error,
          message: err && err.message ? err.message : 'Could not load this file.',
        });
      }
    );

    return () => {
      cancelled = true;
      if (added) document.fonts?.delete(added);
    };
    // Also key on modified (mtime) so a live-update poll (same path, edited
    // bytes) re-loads the face without waiting for a re-select.
  }, [file.fullPath, file.modified, family, scrubbedBlobShaFor(file.path)]);

  return (
    <div class="pane preview-shell">
      {fontState.kind === FontStateKind.Error ? (
        <PaneEmpty icon={FileWarning} title="Couldn't render this font" sub={fontState.message} />
      ) : fontState.kind === FontStateKind.Ready ? (
        <div class="font-specimen" style={{ fontFamily: `"${family}", sans-serif` }}>
          <section class="font-specimen-section">
            <h3 class="text-label font-specimen-label">Preview</h3>
            <div class="font-specimen-waterfall">
              <p class="font-specimen-line">{SPECIMEN_UPPER}</p>
              <p class="font-specimen-line">{SPECIMEN_LOWER}</p>
              <p class="font-specimen-line">{SPECIMEN_DIGITS}</p>
              <p class="font-specimen-pangram">{SPECIMEN_PANGRAM}</p>
            </div>
          </section>
          <section class="font-specimen-section">
            <h3 class="text-label font-specimen-label">Repertoire</h3>
            <div class="font-specimen-repertoire">
              {REPERTOIRE.map((ch, i) => (
                <span key={i} class="font-specimen-glyph">
                  {ch}
                </span>
              ))}
            </div>
          </section>
        </div>
      ) : (
        <span class="sr-only" role="status">
          Loading font
        </span>
      )}
    </div>
  );
}

// ── Binary "data" file card ──────────────────────────────────────────────────

enum FpStateKind {
  Loading = 'loading',
  Ready = 'ready',
  Error = 'error',
}

type FpState =
  | { kind: FpStateKind.Loading }
  | { kind: FpStateKind.Ready; b64: string }
  | { kind: FpStateKind.Error };

/**
 * A binary file has no readable text, so instead of dumping garbled bytes we
 * show a data card: detected type, size, dates, and the same byte-pattern
 * fingerprint the building facade wears (so the two match). The fingerprint is
 * fetched from the server (head-only) — raw binary bytes never reach the client.
 */
function BinaryDataCard({ file }: { file: FileNode }) {
  const [fp, setFp] = useState<FpState>({ kind: FpStateKind.Loading });

  useEffect(() => {
    let cancelled = false;
    setFp({ kind: FpStateKind.Loading });
    fetchFingerprintB64(file.fullPath || '').then(
      (b64) => {
        if (!cancelled) setFp(b64 ? { kind: FpStateKind.Ready, b64 } : { kind: FpStateKind.Error });
      },
      () => !cancelled && setFp({ kind: FpStateKind.Error })
    );
    return () => {
      cancelled = true;
    };
    // Key on modified so a live edit re-fingerprints (the server keys on it too).
  }, [file.fullPath, file.modified, scrubbedBlobShaFor(file.path)]);

  const size = typeof file.size === 'number' ? formatBytes(file.size) : '—';

  return (
    <div class="pane preview-shell binary-card">
      <div class="binary-fingerprint-frame">
        {fp.kind === FpStateKind.Ready ? (
          <img
            class="binary-fingerprint"
            src={`data:image/png;base64,${fp.b64}`}
            alt="Byte-pattern fingerprint"
          />
        ) : (
          <Binary class="binary-fingerprint-fallback" aria-hidden="true" />
        )}
      </div>
      <dl class="binary-card-facts">
        <dt class="text-label">Type</dt>
        <dd>{file.binaryType ?? 'Binary data'}</dd>
        <dt class="text-label">Size</dt>
        <dd>{size}</dd>
        <dt class="text-label">Created</dt>
        <dd>{formatFullDate(file.created)}</dd>
        <dt class="text-label">Modified</dt>
        <dd>{formatFullDate(file.modified)}</dd>
      </dl>
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

  // Version the URL by mtime so an edited image/video/pdf re-fetches on a live
  // update instead of the browser serving the cached bytes for the same path.
  const url = fileUrl(file.fullPath || '', file.modified);
  const kind = _previewKind(file);

  if (kind === PreviewKind.Image) {
    return <img class="preview-image" src={url} alt={file.name || ''} />;
  }
  if (kind === PreviewKind.Video) {
    return <video class="preview-media" src={url} controls aria-label={file.name || 'Video'} />;
  }
  if (kind === PreviewKind.Audio) {
    return <audio class="preview-media" src={url} controls aria-label={file.name || 'Audio'} />;
  }
  if (kind === PreviewKind.Pdf) {
    return (
      <embed
        class="preview-pdf"
        type="application/pdf"
        src={url}
        title={`PDF preview: ${file.name || 'document'}`}
      />
    );
  }

  if (kind === PreviewKind.Font) {
    // Keyed on fullPath so switching files remounts the FontFace state machine.
    return <FontPreview key={file.fullPath} file={file} />;
  }

  // A binary file with no dedicated viewer above (image/pdf/font already
  // returned) → a data card, not a garbled text dump. isDataBuilding's media
  // exclusion covers the rare media file whose extension missed those lists.
  if (isDataBuilding(file)) {
    return <BinaryDataCard key={file.fullPath} file={file} />;
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

export function FilePreviewPane({ state, onClose, onFocus, onExclude }: FilePreviewPaneProps) {
  const { file, rootLabel = '', rootPath = '', remoteUrl, branch = '', isDeleted } = state.value;
  const path = file?.path ?? '';
  const deleted = Boolean(file && isDeleted);

  return (
    <Pane
      titleSlot={
        file ? (
          <PathBreadcrumbs
            path={path}
            extension={file.extension}
            rootLabel={rootLabel}
            rootPath={rootPath}
          />
        ) : (
          <span>No file</span>
        )
      }
      mono
      onFocus={file && typeof onFocus === 'function' ? () => onFocus(file) : undefined}
      focusTitle={`Focus the camera on this file (${KEY_BINDINGS.FOCUS_SELECTION.label})`}
      copyText={file ? path || rootPath : undefined}
      copyLabel="Copy path"
      openUrl={file && !deleted && remoteUrl ? nodeUrl(remoteUrl, branch, path, false) : null}
      openLabel="Open file on origin"
      onClose={onClose}
      onExclude={file && typeof onExclude === 'function' ? () => onExclude(file) : undefined}
      excludeTitle="Exclude this file from the city"
      bodyClass="editor-body surface-app"
      footerSlot={file && !deleted ? <PaneStats items={fileStatItems(file)} /> : null}
    >
      {deleted ? (
        <div class="empty-state empty-state--lg file-deleted-state">
          <FileX class="icon" aria-hidden="true" />
          <p class="text-card-title">This file was deleted</p>
          <p class="text-card-sub">
            It no longer exists in the repo, so there&rsquo;s nothing to preview.
          </p>
        </div>
      ) : (
        _previewBody(file)
      )}
    </Pane>
  );
}
