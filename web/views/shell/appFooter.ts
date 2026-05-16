// views/shell/appFooter.ts — Sitewide bottom status bar. Three sections:
//   left   — current selection metadata (language · lines · size · created
//            · modified for files; file/dir counts + size for directories)
//   center — repo information (project name + absolute root path)
//   right  — combined status indicator: [dot] <status text>
//            One dot, two channels of state:
//              color    — rebuild state (green=idle, yellow=rebuilding,
//                         red=error)
//              animation — live state (slow heartbeat when polling on,
//                         static when paused, fast pulse when rebuilding,
//                         static when error)
//            Hover tooltip surfaces the live state ("Live updates: on/off")
//            and the rebuild error message (when applicable).

import { ASPHALT, BUILDING_PALETTE } from '@/config';
import { DateSource, NodeKind } from '@/types';
import { makeExtensionBadge } from './badge.js';
import { makeLucideIcon } from './icon.js';

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

export interface FooterRepoInfo {
  /** Working-tree directory name — always present. */
  name: string;
  /** Absolute filesystem path of the working tree. */
  root: string;
  /** Current branch (e.g. "main") or "detached @ <sha>". null for non-git. */
  branch: string | null;
  /** Web URL for the origin remote ("" / null when no parseable remote). */
  remoteUrl: string | null;
  /** Last commit's short SHA — surfaced in the title tooltip. */
  headSha: string | null;
  /** Last commit's subject line — surfaced in the title tooltip. */
  headSubject: string | null;
  /** Working tree differs from HEAD or has untracked files. */
  dirty: boolean;
}

const NOOP_API = {
  setSelection(_sel: FooterSelection | null) {},
  setStatus(_status: FooterStatus) {},
  setRepoInfo(_info: FooterRepoInfo | null) {},
};

interface InitAppFooterOpts {
  /** fn() — fires when the user clicks the reset-view button in the footer's right section. Same handler the R key fires. */
  onResetView?: (() => void) | null;
}

/**
 * Initialise the sitewide footer. Returns:
 *   setStatus({ liveEnabled, rebuildStatus, lastUpdatedAt, errorMessage })
 *                                            — right section (combined indicator)
 *   setRepoInfo({ ... })                     — center section
 *   setSelection(sel | null)                 — left section (badge + metadata)
 *
 * The leading path-badge reads palette + asphalt from the live config
 * stores at render time and re-renders on any change, so editing an
 * extension hue or the asphalt color in Controls repaints the pill.
 */
export function initAppFooter(opts: InitAppFooterOpts = {}) {
  const { onResetView = null } = opts;
  const footer = document.getElementById('app-footer');
  if (!footer) return NOOP_API;

  const selectionEl = document.createElement('div');
  selectionEl.className = 'app-footer-section app-footer-left';

  const centerEl = document.createElement('div');
  centerEl.className = 'app-footer-section app-footer-center';

  const statusContainerEl = document.createElement('div');
  statusContainerEl.className = 'app-footer-section app-footer-right';
  const statusEl = document.createElement('span');
  statusEl.className = 'app-footer-status';
  statusContainerEl.appendChild(statusEl);

  // Refresh button — the footer's "act like a fresh page load" trigger.
  // The host wires it to a callback that re-fetches the manifest AND
  // resets the camera (the R key continues to fire just the camera
  // reset via scene/inputHandlers).
  if (typeof onResetView === 'function') {
    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.className = 'app-footer-button';
    resetBtn.title = 'Refresh — rebuild the city and reset the view';
    resetBtn.setAttribute('aria-label', 'Refresh');
    resetBtn.appendChild(makeLucideIcon('refresh-cw'));
    resetBtn.addEventListener('click', () => {
      onResetView();
    });
    statusContainerEl.appendChild(resetBtn);
  }

  footer.replaceChildren(selectionEl, centerEl, statusContainerEl);

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
      detailText = 'error';
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

    // Compose the hover tooltip. Error message wins when present —
    // otherwise show the live-state summary so users can discover the
    // play/pause distinction (the dot's heartbeat already hints at it).
    const liveLabel = `Live updates: ${status.liveEnabled ? 'on' : 'off'}`;
    if (status.rebuildStatus === 'error' && status.errorMessage) {
      statusEl.title = `${liveLabel} · ${status.errorMessage}`;
    } else if (status.rebuildStatus === 'idle' && status.lastUpdatedAt > 0) {
      const exact = new Date(status.lastUpdatedAt).toLocaleString();
      statusEl.title = `${liveLabel} · last rebuild ${exact}`;
    } else {
      statusEl.title = liveLabel;
    }
    statusEl.setAttribute('aria-label', statusEl.title);

    // Dot (color = rebuild state; animation = live state, scoped by CSS).
    const dot = document.createElement('span');
    dot.className = 'app-footer-status-dot';
    statusEl.appendChild(dot);

    // Status detail (timestamp / "rebuilding…" / "error")
    const detail = document.createElement('span');
    detail.className = 'app-footer-status-detail';
    detail.textContent = detailText;
    statusEl.appendChild(detail);
  }

  function setRepoInfo(info: FooterRepoInfo | null): void {
    centerEl.replaceChildren();
    if (!info) return;

    const wrap = document.createElement('span');
    wrap.className = 'app-footer-repo';

    // Project name — shown first so the label anchors the rest of the row.
    // coordinator.ts stamps the friendly display label onto info.name before
    // calling setRepoInfo, so this always shows "owner/repo" for URL sources
    // instead of the raw cache-directory hash.
    if (info.name) {
      const nameEl = document.createElement('span');
      nameEl.className = 'app-footer-repo-name';
      nameEl.textContent = info.name;
      nameEl.title = info.root || info.name;
      wrap.appendChild(nameEl);
    }

    if (info.branch) {
      if (info.name) wrap.appendChild(_makeSep());
      const branch = document.createElement('span');
      branch.className = 'app-footer-repo-branch';
      if (info.dirty) branch.classList.add('is-dirty');
      // Lucide-style git-branch glyph wouldn't load here (the icon
      // helper is for buttons); a textual prefix keeps the bar
      // monospace-friendly without pulling in another dependency.
      branch.textContent = info.dirty ? `⎇ ${info.branch}●` : `⎇ ${info.branch}`;
      wrap.appendChild(branch);
    }

    if (info.remoteUrl) {
      if (info.name || info.branch) wrap.appendChild(_makeSep());
      const link = document.createElement('a');
      link.className = 'app-footer-repo-link';
      link.href = _branchAwareRepoUrl(info.remoteUrl, info.branch);
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = 'repo';
      // Hover tooltip surfaces the destination so users can see where
      // a click will take them (and which branch the link is pointing at).
      link.title = info.branch
        ? `${info.remoteUrl} · ⎇ ${info.branch}`
        : info.remoteUrl;
      wrap.appendChild(link);
    }

    centerEl.appendChild(wrap);
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
      selectionEl.appendChild(
        makeExtensionBadge(sel.extension ?? null, false, huePalette, asphaltColor)
      );
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

  return { setSelection, setStatus, setRepoInfo };
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

/**
 * Append the host-appropriate "view at branch" path to a repo URL so
 * the link opens the repo on the same branch the user is looking at.
 * Falls back to the bare URL for hosts we don't recognize — better a
 * working repo home than a broken /tree URL.
 */
function _branchAwareRepoUrl(url: string, branch: string | null): string {
  if (!branch) return url;
  const safeBranch = encodeURIComponent(branch);
  if (/github\.com/i.test(url)) return `${url}/tree/${safeBranch}`;
  if (/gitlab\./i.test(url)) return `${url}/-/tree/${safeBranch}`;
  if (/bitbucket\.org/i.test(url)) return `${url}/src/${safeBranch}`;
  return url;
}

function _item(text: string, source?: string, hoverText?: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = 'app-footer-item';

  // Use a dedicated label node so that swapping text on hover doesn't wipe
  // the source-badge child element that may be appended below.
  const labelNode = document.createTextNode(text);
  span.appendChild(labelNode);

  if (source) {
    const src = document.createElement('span');
    src.className = 'app-footer-source';
    src.textContent = `(${source})`;
    span.appendChild(src);
  }

  if (hoverText) {
    span.style.cursor = 'help';
    span.addEventListener('mouseenter', () => {
      labelNode.textContent = hoverText;
    });
    span.addEventListener('mouseleave', () => {
      labelNode.textContent = text;
    });
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
