// views/shell/appFooter.ts — Sitewide bottom status bar. Three sections:
//   left   — combined status indicator: [dot] <status text>
//            One dot, two channels of state:
//              color    — rebuild state (green=idle, yellow=rebuilding,
//                         red=error)
//              animation — live state (slow heartbeat when polling on,
//                         static when paused, fast pulse when rebuilding,
//                         static when error)
//            Hover tooltip surfaces the live state ("Live updates: on/off")
//            and the rebuild error message (when applicable).
//   center — repo information (project name + absolute root path)
//   right  — current selection metadata (language · lines · size · created
//            · modified for files; file/dir counts + size for directories)

import { DateSource, NodeKind } from '@/types';

interface FooterFileSelection {
  kind: NodeKind.File;
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

/**
 * Initialise the sitewide footer. Returns:
 *   setStatus({ liveEnabled, rebuildStatus, lastUpdatedAt, errorMessage })
 *                                            — left section (combined indicator)
 *   setRepoInfo({ ... })                     — center section
 *   setSelection(sel | null)                 — right section
 */
export function initAppFooter() {
  const footer = document.getElementById('app-footer');
  if (!footer) return NOOP_API;

  const leftEl = document.createElement('div');
  leftEl.className = 'app-footer-section app-footer-left';
  const statusEl = document.createElement('span');
  statusEl.className = 'app-footer-status';
  leftEl.appendChild(statusEl);

  const centerEl = document.createElement('div');
  centerEl.className = 'app-footer-section app-footer-center';
  const rightEl = document.createElement('div');
  rightEl.className = 'app-footer-section app-footer-right';
  footer.replaceChildren(leftEl, centerEl, rightEl);

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
    wrap.title = _buildRepoTooltip(info);

    if (info.name) {
      const name = document.createElement('span');
      name.className = 'app-footer-repo-name';
      name.textContent = info.name;
      wrap.appendChild(name);
    }

    if (info.branch) {
      wrap.appendChild(_makeRepoSep());
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
      wrap.appendChild(_makeRepoSep());
      const link = document.createElement('a');
      link.className = 'app-footer-repo-link';
      link.href = info.remoteUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = _shortRemoteLabel(info.remoteUrl);
      wrap.appendChild(link);
    }

    centerEl.appendChild(wrap);
  }

  function setSelection(sel: FooterSelection | null): void {
    rightEl.replaceChildren();
    if (!sel) return;

    if (sel.kind === NodeKind.File) {
      if (sel.language) rightEl.appendChild(_item(sel.language));
      if (sel.lines != null) rightEl.appendChild(_item(`${sel.lines} lines`));
      if (sel.size != null) rightEl.appendChild(_item(_formatBytes(sel.size)));
      if (sel.modified)
        rightEl.appendChild(_item(`modified ${_formatDate(sel.modified)}`, sel.dateSource));
      if (sel.created)
        rightEl.appendChild(_item(`created ${_formatDate(sel.created)}`, sel.dateSource));
    } else if (sel.kind === NodeKind.Directory) {
      rightEl.appendChild(_item('Directory'));
      if (sel.files != null) rightEl.appendChild(_item(`${sel.files} files`));
      if (sel.dirs != null) rightEl.appendChild(_item(`${sel.dirs} dirs`));
      if (sel.size != null) rightEl.appendChild(_item(_formatBytes(sel.size)));
    }
  }

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

function _makeRepoSep(): HTMLSpanElement {
  const sep = document.createElement('span');
  sep.className = 'app-footer-repo-sep';
  sep.textContent = '·';
  return sep;
}

function _shortRemoteLabel(url: string): string {
  // Strip the scheme and trailing slashes so the link reads as
  // "github.com/org/repo" instead of the full URL — fits better in the
  // bar and is still recognizable.
  return url.replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

function _buildRepoTooltip(info: FooterRepoInfo): string {
  const lines: string[] = [];
  if (info.name || info.root) lines.push(info.root || info.name);
  if (info.branch) {
    lines.push(info.dirty ? `branch: ${info.branch} (dirty)` : `branch: ${info.branch}`);
  }
  if (info.headSha || info.headSubject) {
    const sha = info.headSha ? `${info.headSha} ` : '';
    const subj = info.headSubject || '';
    lines.push(`${sha}${subj}`.trim());
  }
  if (info.remoteUrl) lines.push(info.remoteUrl);
  return lines.join('\n');
}

function _item(text: string, source?: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = 'app-footer-item';
  span.textContent = text;
  if (source) {
    const src = document.createElement('span');
    src.className = 'app-footer-source';
    src.textContent = `(${source})`;
    span.appendChild(src);
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
