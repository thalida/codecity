// views/FilePreviewPane.tsx — body content for the right sidebar: an image,
// video, audio, pdf or highlighted-code preview of the selected file. Owns
// nothing about the sidebar shell itself, which is layout/CitySidebarRight.tsx.

import './FilePreviewPane.css';
import type { ReadonlySignal } from '@preact/signals';
import { useState, useEffect } from 'preact/hooks';
import hljs from 'highlight.js/lib/common';
import type { FileNode, SourceRef } from '@/types';

/** Which preview a file gets, by extension. Text is the catch-all, and falls
 *  back to a binary notice when the bytes don't decode as UTF-8. */
export enum PreviewKind {
  Image = 'image',
  Video = 'video',
  Audio = 'audio',
  Pdf = 'pdf',
  Font = 'font',
  Text = 'text',
}
import { PaneStats } from '@/components/panes/PaneStats/PaneStats';
import { fileStatItems } from '@/components/panes/PaneStats/statItems';
import { hasNoContentAtScrub, scrubbedBlobShaFor } from '@/state/stores/timeline';
import {
  IMAGE_EXTS,
  VIDEO_EXTS,
  AUDIO_EXTS,
  PDF_EXTS,
  FONT_EXTS,
} from '@/constants/fileExtensions';
import {
  FileWarning,
  FileX,
  Info,
  MousePointerClick,
  LoaderCircle,
  Binary,
  CloudDownload,
} from 'lucide-preact';
import { Pane } from '@/components/panes/Pane/Pane';
import { PaneEmpty } from '@/components/panes/PaneEmpty/PaneEmpty';
import { KEY_BINDINGS } from '@/constants/keyboard';
import { PathBreadcrumbs } from '@/components/panes/PathBreadcrumbs/PathBreadcrumbs';
import { nodeUrl } from '@/utils/remoteUrls';
import { formatBytes } from '@/utils/format';
import { formatFullDate } from '@/utils/dates';
import { languageFor } from '@/utils/syntaxLanguages';
import { isDataBuilding } from '@/utils/fileKind';
import { ContentPendingError } from '@codecity/city';
import { API } from '@/apiClient';

// In sync with MAX_FILE_BYTES in the API, so anything it will serve, this will
// render. Past that the server rejects the fetch and the error state shows it.
const TEXT_PREVIEW_MAX_BYTES = 100 * 1024 * 1024;

// Degradation tiers, tuned to hold main-thread blocking near 250ms: drop
// highlighting first, then the gutter, whose span-per-line is what hangs.
const HIGHLIGHT_MAX_BYTES = 512 * 1024;
const GUTTER_MAX_BYTES = 1 * 1024 * 1024;

// ── State shape for Preact component ─────────────────────────────────────────

export interface FilePreviewPaneState {
  file: FileNode | null;
  /** Which repo the file's path is relative to; every read needs it. */
  source?: SourceRef | null;
  /** Repo label + root path, for the header path breadcrumb. */
  rootLabel?: string;
  rootPath?: string;
  /** Repo remote URL + branch, for the header open-on-origin link. */
  remoteUrl?: string | null;
  branch?: string;
  /** No content at the commit being shown, in either direction in time, so
   *  /api/file would 404. Show the unavailable state instead of fetching. */
  isAbsent?: boolean;
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
  Pending = 'pending',
  Error = 'error',
}

type TextState =
  | { kind: TextStateKind.Loading }
  | { kind: TextStateKind.Text; text: string }
  | { kind: TextStateKind.Pending; message: string }
  | { kind: TextStateKind.Error; message: string };

interface FileTextPreviewProps {
  file: FileNode;
  source: SourceRef;
}

/** Fetches the bytes, then renders the editor or an error. Built this way so
 *  the gutter and <pre> never linger empty beside an error message. */
function FileTextPreview({ file, source }: FileTextPreviewProps) {
  const [textState, setTextState] = useState<TextState>({ kind: TextStateKind.Loading });

  useEffect(() => {
    setTextState({ kind: TextStateKind.Loading });
    let cancelled = false;
    API.fetchFileText(source, file.path, file.modified, scrubbedBlobShaFor(file.path)).then(
      (text) => {
        if (cancelled) return;
        setTextState({ kind: TextStateKind.Text, text });
      },
      (err) => {
        if (cancelled) return;
        setTextState({
          kind: err instanceof ContentPendingError ? TextStateKind.Pending : TextStateKind.Error,
          message: err && err.message ? err.message : 'Unknown error',
        });
      }
    );
    return () => {
      cancelled = true;
    };
    // Keyed on mtime too, so an edit picked up by the poll re-fetches instead
    // of waiting for the user to re-select the file.
  }, [source.src, file.path, file.modified, scrubbedBlobShaFor(file.path)]);

  return (
    <div class="pane preview-shell">
      {textState.kind === TextStateKind.Error ? (
        <PaneEmpty icon={FileWarning} title="Couldn't load this file" sub={textState.message} />
      ) : textState.kind === TextStateKind.Pending ? (
        <PaneEmpty icon={CloudDownload} title="Not downloaded yet" sub={textState.message} />
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
  // file.size is authoritative; text.length is UTF-16 units, close enough for
  // ASCII-heavy source when the manifest has no size.
  const sizeBytes = typeof file.size === 'number' ? file.size : text.length;
  const skipHighlight = sizeBytes > HIGHLIGHT_MAX_BYTES;
  const skipGutter = sizeBytes > GUTTER_MAX_BYTES;

  // Counted off the raw text, not the highlighted HTML, which preserves
  // newlines anyway.
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
  Pending = 'pending',
  Error = 'error',
}

type FontState =
  | { kind: FontStateKind.Loading }
  | { kind: FontStateKind.Ready }
  | { kind: FontStateKind.Pending; message: string }
  | { kind: FontStateKind.Error; message: string };

// Specimen content: a waterfall (cases, digits, pangram), then a Font-Book
// style grid of every glyph we render.
const SPECIMEN_UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const SPECIMEN_LOWER = 'abcdefghijklmnopqrstuvwxyz';
const SPECIMEN_DIGITS = '1234567890';
const SPECIMEN_PANGRAM = 'The quick brown fox jumps over the lazy dog';

// Printable ASCII (space skipped, it is a blank cell) plus a curated extended
// run. Missing glyphs fall back rather than hide: real coverage needs parsing.
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

// Sniffed before FontFace sees the bytes, so an LFS pointer or a mis-named text
// file can't make the decoder log a failure for every attempt.
const FONT_SIGNATURES = new Set([
  0x00010000, // TrueType outlines
  0x4f54544f, // 'OTTO' — OpenType with CFF outlines
  0x74727565, // 'true' — TrueType (legacy Mac)
  0x74797031, // 'typ1' — PostScript in an sfnt wrapper
  0x74746366, // 'ttcf' — TrueType/OpenType collection
  0x774f4646, // 'wOFF' — WOFF
  0x774f4632, // 'wOF2' — WOFF2
]);

/** Null when the bytes are a font we can render, else the reason for the
 *  fallback notice. A pointer never reaches here: the endpoint answers 202. */
function fontRejectReason(buf: ArrayBuffer): string | null {
  if (buf.byteLength < 4) return 'This file is empty or too small to be a font.';
  const signature = new DataView(buf).getUint32(0, false);
  if (FONT_SIGNATURES.has(signature)) return null;
  return 'This file is not a recognized font (ttf, otf, woff, or woff2).';
}

interface FontPreviewProps {
  file: FileNode;
  source: SourceRef;
}

/** Renders a live specimen through the FontFace API. The face is removed on
 *  unmount and on a file change, so switching never orphans one. */
function FontPreview({ file, source }: FontPreviewProps) {
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

    API.fetchFileBytes(source, file.path, file.modified, scrubbedBlobShaFor(file.path)).then(
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
          kind: err instanceof ContentPendingError ? FontStateKind.Pending : FontStateKind.Error,
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
  }, [source.src, file.path, file.modified, family, scrubbedBlobShaFor(file.path)]);

  return (
    <div class="pane preview-shell">
      {fontState.kind === FontStateKind.Error ? (
        <PaneEmpty icon={FileWarning} title="Couldn't render this font" sub={fontState.message} />
      ) : fontState.kind === FontStateKind.Pending ? (
        <PaneEmpty icon={CloudDownload} title="Not downloaded yet" sub={fontState.message} />
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
  Pending = 'pending',
  Error = 'error',
}

type FpState =
  | { kind: FpStateKind.Loading }
  | { kind: FpStateKind.Ready; url: string }
  | { kind: FpStateKind.Pending }
  | { kind: FpStateKind.Error };

/** A data card instead of garbled bytes: type, size, dates, and the same
 *  fingerprint the building wears. Raw bytes never reach the client. */
function BinaryDataCard({ file, source }: { file: FileNode; source: SourceRef }) {
  const [fp, setFp] = useState<FpState>({ kind: FpStateKind.Loading });

  useEffect(() => {
    let cancelled = false;
    let objUrl: string | null = null;
    setFp({ kind: FpStateKind.Loading });
    API.fetchFingerprintBlob(source, file.path, file.modified).then(
      (blob) => {
        if (cancelled) return;
        objUrl = URL.createObjectURL(blob);
        setFp({ kind: FpStateKind.Ready, url: objUrl });
      },
      (err) => {
        if (cancelled) return;
        // An undownloaded file has no byte pattern of its own to draw yet, so
        // the frame says so rather than showing the generic failure glyph.
        setFp({
          kind: err instanceof ContentPendingError ? FpStateKind.Pending : FpStateKind.Error,
        });
      }
    );
    return () => {
      cancelled = true;
      if (objUrl) URL.revokeObjectURL(objUrl);
    };
    // Key on modified so a live edit re-fingerprints (the server keys on it too).
  }, [source.src, file.path, file.modified, scrubbedBlobShaFor(file.path)]);

  // Not '—': the blob was never downloaded, so its size is unknown rather
  // than absent, and a dash reads as "nothing here".
  const size = typeof file.size === 'number' ? formatBytes(file.size) : 'Not downloaded';

  return (
    <div class="pane preview-shell binary-card">
      <div class="binary-fingerprint-frame">
        {fp.kind === FpStateKind.Ready ? (
          <img class="binary-fingerprint" src={fp.url} alt="Byte-pattern fingerprint" />
        ) : fp.kind === FpStateKind.Pending ? (
          <CloudDownload class="binary-fingerprint-fallback" aria-label="Not downloaded yet" />
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

function _previewBody(file: FileNode | null, source: SourceRef | null) {
  if (!file) {
    return (
      <PaneEmpty
        icon={MousePointerClick}
        title="Nothing to preview"
        sub="Select a file in the city to inspect it here."
      />
    );
  }
  // No manifest means no repo to read the file out of.
  if (!source) return null;

  // Scrubbed commits pin a version; Live keys on mtime, so an edited
  // image/video/pdf re-fetches instead of being served from the browser cache.
  const url = API.fileUrl(source, file.path, file.modified, scrubbedBlobShaFor(file.path));
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
    // Keyed on path so switching files remounts the FontFace state machine.
    return <FontPreview key={file.path} file={file} source={source} />;
  }

  // Binary with no dedicated viewer above: a data card, not a text dump.
  if (isDataBuilding(file)) {
    return <BinaryDataCard key={file.path} file={file} source={source} />;
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

  // Keyed on path so switching files remounts the fetch state machine.
  return <FileTextPreview key={file.path} file={file} source={source} />;
}

// ── Preact component ─────────────────────────────────────────────────────────

export function FilePreviewPane({ state, onClose, onFocus, onExclude }: FilePreviewPaneProps) {
  const {
    file,
    source = null,
    rootLabel = '',
    rootPath = '',
    remoteUrl,
    branch = '',
    isAbsent,
  } = state.value;
  const path = file?.path ?? '';
  // Absent from the scrub tree, or in it with no blob here: either way a read
  // by path would answer with HEAD's bytes, or 404 for a file HEAD dropped.
  const absent = Boolean(file && (isAbsent || hasNoContentAtScrub(path)));

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
      openUrl={file && !absent && remoteUrl ? nodeUrl(remoteUrl, branch, path, false) : null}
      openLabel="Open file on origin"
      onClose={onClose}
      onExclude={file && typeof onExclude === 'function' ? () => onExclude(file) : undefined}
      excludeTitle="Exclude this file from the city"
      bodyClass="editor-body surface-app"
      footerSlot={file && !absent ? <PaneStats items={fileStatItems(file)} /> : null}
    >
      {absent ? (
        <PaneEmpty icon={FileX} title="File not available" modifier="empty-state--absent" />
      ) : (
        _previewBody(file, source)
      )}
    </Pane>
  );
}
