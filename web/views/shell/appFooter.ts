// views/shell/appFooter.ts — Sitewide bottom status bar. Two sections:
//   left   — combined status indicator: [dot] detail-text
//            One dot, two channels of state:
//              color    — rebuild state (green=idle, yellow=rebuilding,
//                         red=error)
//              animation — live state (slow heartbeat when polling on,
//                         static when paused, fast pulse when rebuilding,
//                         static when error)
//            A detail <span> next to the dot shows human-readable status
//            ("rebuilt 5s ago", "rebuilding…", "error: <msg>", "paused").
//            title= on the wrapper is a fallback tooltip for narrow widths.
//   right  — current selection metadata (language · lines · size · created
//            · modified for files; file/dir counts + size for directories)
//
// The refresh/reset-view button has moved to the header (far right).

import { ASPHALT, BUILDING_PALETTE } from '@/config';
import { DateSource, NodeKind } from '@/types';
import { makeExtensionBadge } from './badge.js';
import { makeLucideIcon } from './icon.js';
import { toHttpsRepoUrl } from './displayLabel.js';

interface FooterFileSelection {
  kind: NodeKind.File;
  /** File extension (with leading dot, e.g. ".ts"). Drives the color of the path-badge pill. */
  extension?: string;
  language?: string;
  lines?: number | null;
  size?: number | null;
  modified?: string | null;
  created?: string | null;
  dateSource?: DateSource;
}

interface FooterDirectorySelection {
  kind: NodeKind.Directory;
  files?: number | null;
  dirs?: number | null;
  size?: number | null;
}

export type FooterSelection = FooterFileSelection | FooterDirectorySelection;

export interface FooterStatus {
  /** True when live-poll is active; renders as `live`. False renders as `paused`. */
  liveEnabled: boolean;
  /** Must remain in sync with `RebuildStatus` in `liveStatus.ts` (intentional decoupling). */
  rebuildStatus: 'idle' | 'rebuilding' | 'error';
  /** Epoch millis of the most recent successful rebuild; 0 ⇒ unknown. */
  lastUpdatedAt: number;
  /** Surfaced as the indicator's `title` (hover tooltip) when rebuildStatus === 'error'. */
  errorMessage: string | null;
}

const NOOP_API = {
  setSelection(_sel: FooterSelection | null) {},
  setStatus(_status: FooterStatus) {},
  setSourceUrl(_url?: string) {},
};

interface InitAppFooterOpts {
  /** Original src URL when the loaded source is a git URL. Used to render the open-repo link. */
  sourceUrl?: string;
}

/**
 * Initialise the sitewide footer. Returns:
 *   setStatus({ liveEnabled, rebuildStatus, lastUpdatedAt, errorMessage })
 *                                            — right section (combined indicator)
 *   setSelection(sel | null)                 — left section (badge + metadata)
 *
 * The leading path-badge reads palette + asphalt from the live config
 * stores at render time and re-renders on any change, so editing an
 * extension hue or the asphalt color in Controls repaints the pill.
 */
export function initAppFooter(opts: InitAppFooterOpts = {}) {
  const footer = document.getElementById('app-footer');
  if (!footer) return NOOP_API;

  const statusContainerEl = document.createElement('div');
  statusContainerEl.className = 'app-footer-section app-footer-left';
  const statusEl = document.createElement('span');
  statusEl.className = 'app-footer-status';
  statusContainerEl.appendChild(statusEl);

  // Repo link — rendered after status detail when a git URL source is loaded.
  let _repoLinkEl: HTMLAnchorElement | null = null;
  let _sourceUrl: string | undefined = opts.sourceUrl;

  function _syncRepoLink(): void {
    if (_sourceUrl) {
      if (!_repoLinkEl) {
        const a = document.createElement('a');
        a.className = 'app-footer-repo-link';
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.appendChild(makeLucideIcon('external-link'));
        _repoLinkEl = a;
        statusContainerEl.appendChild(_repoLinkEl);
      }
      _repoLinkEl.href = toHttpsRepoUrl(_sourceUrl);
      _repoLinkEl.title = `Open repo: ${_sourceUrl}`;
    } else {
      if (_repoLinkEl) {
        _repoLinkEl.remove();
        _repoLinkEl = null;
      }
    }
  }

  function setSourceUrl(url?: string): void {
    _sourceUrl = url;
    _syncRepoLink();
  }

  // Initial render of repo link if sourceUrl was passed at init time.
  _syncRepoLink();

  const selectionEl = document.createElement('div');
  selectionEl.className = 'app-footer-section app-footer-right';

  footer.replaceChildren(statusContainerEl, selectionEl);

  function setStatus(status: FooterStatus): void {
    statusEl.replaceChildren();
    statusEl.classList.remove(
      'is-rebuilding',
      'is-ready',
      'is-error',
      'is-live',
      'is-paused'
    );
    statusEl.removeAttribute('title');

    let buildModifier: 'is-rebuilding' | 'is-ready' | 'is-error';
    let detailText: string;
    if (status.rebuildStatus === 'rebuilding') {
      buildModifier = 'is-rebuilding';
      detailText = 'rebuilding…';
    } else if (status.rebuildStatus === 'error') {
      buildModifier = 'is-error';
      detailText = status.errorMessage ? `error: ${status.errorMessage}` : 'error';
    } else {
      buildModifier = 'is-ready';
      // 'ready' literal is a guard for unit tests or any code path that
      // calls setStatus before LAST_UPDATED_AT is seeded. Production
      // boot seeds the stamp in coordinator.ts before this setter runs.
      detailText =
        status.lastUpdatedAt > 0
          ? _relativeTime(status.lastUpdatedAt, Date.now())
          : 'ready';
    }
    statusEl.classList.add(buildModifier);
    statusEl.classList.add(status.liveEnabled ? 'is-live' : 'is-paused');

    // Compose the hover tooltip on the wrapper so the dot-only layout
    // still surfaces full context on hover. Error message wins when present —
    // otherwise show the live-state summary so users can discover the
    // play/pause distinction (the dot's heartbeat already hints at it).
    const liveLabel = `Live updates: ${status.liveEnabled ? 'on' : 'off'}`;
    if (status.rebuildStatus === 'error' && status.errorMessage) {
      statusEl.title = `${liveLabel} · error: ${status.errorMessage}`;
    } else if (status.rebuildStatus === 'idle' && status.lastUpdatedAt > 0) {
      statusEl.title = `${liveLabel} · rebuilt ${detailText}`;
    } else if (status.rebuildStatus === 'rebuilding') {
      statusEl.title = `${liveLabel} · rebuilding…`;
    } else {
      statusEl.title = liveLabel;
    }
    statusEl.setAttribute('aria-label', statusEl.title);

    // Dot — color = rebuild state; animation = live state, scoped by CSS.
    const dot = document.createElement('span');
    dot.className = 'app-footer-status-dot';
    statusEl.appendChild(dot);

    // Detail text — sits next to the dot; hidden via CSS at narrow widths.
    const detail = document.createElement('span');
    detail.className = 'app-footer-status-detail';
    detail.textContent = detailText;
    statusEl.appendChild(detail);
  }

  // Last selection cached so config-store subscriptions can re-render
  // with the same selection when the palette / asphalt color changes.
  let lastSelection: FooterSelection | null = null;

  function setSelection(sel: FooterSelection | null): void {
    lastSelection = sel;
    selectionEl.replaceChildren();
    if (!sel) return;

    // Palette + asphalt read fresh at render time so the badge follows
    // live config edits (re-render is triggered by the subscriptions
    // below when those stores change).
    const huePalette = BUILDING_PALETTE.get().HUE_EXT_MAP || {};
    const asphaltColor = ASPHALT.get().COLOR;

    // Always-leading chip (no dot before it). After the chip, the
    // metadata items are joined with `·` separators to mirror the
    // center repo section and reduce visual ambiguity between adjacent
    // values.
    const items: HTMLElement[] = [];
    if (sel.kind === NodeKind.File) {
      const extBadge = makeExtensionBadge(sel.extension ?? null, false, huePalette, asphaltColor);
      if (sel.language) extBadge.title = sel.language;
      selectionEl.appendChild(extBadge);
      if (sel.language) items.push(_item(sel.language));
      if (sel.lines != null) items.push(_item(`${sel.lines} lines`));
      if (sel.size != null) items.push(_item(_formatBytes(sel.size)));
      if (sel.modified) {
        const relMod = `modified ${_relativeTime(new Date(sel.modified).getTime(), Date.now())}`;
        const absMod = `modified ${_formatDate(sel.modified)}`;
        items.push(_item(relMod, sel.dateSource, absMod));
      }
      if (sel.created) {
        const relCre = `created ${_relativeTime(new Date(sel.created).getTime(), Date.now())}`;
        const absCre = `created ${_formatDate(sel.created)}`;
        items.push(_item(relCre, sel.dateSource, absCre));
      }
    } else if (sel.kind === NodeKind.Directory) {
      selectionEl.appendChild(makeExtensionBadge(null, true, huePalette, asphaltColor));
      items.push(_item('Directory'));
      if (sel.files != null) items.push(_item(`${sel.files} files`));
      if (sel.dirs != null) items.push(_item(`${sel.dirs} dirs`));
      if (sel.size != null) items.push(_item(_formatBytes(sel.size)));
    }
    for (let i = 0; i < items.length; i++) {
      if (i > 0) selectionEl.appendChild(_makeSep());
      selectionEl.appendChild(items[i]);
    }
  }

  // Live config: see appHeader for the same pattern. Drop the initial
  // synchronous callback that nanostores fires at subscribe time so we
  // don't re-render before the host has set an initial selection.
  let _ready = false;
  const _reRender = () => {
    if (_ready) setSelection(lastSelection);
  };
  BUILDING_PALETTE.subscribe(_reRender);
  ASPHALT.subscribe(_reRender);
  _ready = true;

  return { setSelection, setStatus, setSourceUrl };
}

const SEC_MS = 1000;
const MIN_MS = 60 * SEC_MS;
const HOUR_MS = 60 * MIN_MS;
const DAY_MS = 24 * HOUR_MS;
function _relativeTime(then: number, now: number): string {
  const diff = Math.max(0, now - then);
  if (diff < 5 * SEC_MS) return 'just now';
  if (diff < MIN_MS) return `${Math.floor(diff / SEC_MS)}s ago`;
  if (diff < HOUR_MS) return `${Math.floor(diff / MIN_MS)}m ago`;
  if (diff < DAY_MS) return `${Math.floor(diff / HOUR_MS)}h ago`;
  return `${Math.floor(diff / DAY_MS)}d ago`;
}

function _makeSep(): HTMLSpanElement {
  const sep = document.createElement('span');
  sep.className = 'app-footer-sep';
  sep.textContent = '·';
  return sep;
}

function _item(text: string, source?: string, hoverText?: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = 'app-footer-item';
  span.textContent = text;

  if (source) {
    const src = document.createElement('span');
    src.className = 'app-footer-source';
    src.textContent = `(${source})`;
    span.appendChild(src);
  }

  if (hoverText) {
    span.title = hoverText;
  }

  return span;
}

const BYTES_PER_KB = 1024;
const BYTES_PER_MB = 1024 * 1024;
function _formatBytes(bytes: number): string {
  if (bytes < BYTES_PER_KB) return `${bytes} B`;
  if (bytes < BYTES_PER_MB) return `${(bytes / BYTES_PER_KB).toFixed(1)} KB`;
  return `${(bytes / BYTES_PER_MB).toFixed(1)} MB`;
}

const DATE_FORMAT_OPTIONS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
};
function _formatDate(isoString: string | null | undefined): string {
  if (!isoString) return '—';
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return isoString;
  return d.toLocaleDateString('en-US', DATE_FORMAT_OPTIONS);
}
