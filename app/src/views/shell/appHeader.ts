// views/shell/appHeader.ts — Sitewide top header. Layout (left → right):
//   refresh (gem) icon button   — far left
//   project button (icon + label + @branch pill) → opens source picker
//   repo link icon (if git url)
//   #app-title slot: chip + path breadcrumb + copy button   — center
//
// When no path is selected (or only the root), #app-title is empty.

import { ASPHALT, BUILDING_PALETTE } from '@/config';
import { makeGemIcon, makeLucideIcon } from '../widgets/icon.js';
import { makeExtensionBadge } from '../widgets/badge.js';
import { toHttpsRepoUrl } from '../widgets/displayLabel.js';
import { fitSegments } from '../widgets/pathTruncate.js';

// How long the "Copied!" badge lingers after the copy button is clicked.
const COPY_FEEDBACK_DURATION_MS = 1500;

export type HeaderSelection =
  | {
      kind: 'file' | 'dir';
      path: string;
      fullPath?: string;
      extension?: string;
      isDir?: boolean;
    }
  | {
      kind: 'commit';
      sha: string;
      authors: string[];
    };

interface InitAppHeaderOpts {
  /** project name shown in the project button on the left */
  rootLabel?: string;
  /** the path string the segment-click handler should receive when the root is clicked (e.g. "." or "") */
  rootPath?: string;
  /** fn(path:string) — fires when the user clicks a breadcrumb segment. Caller selects the matching node. */
  onSegmentClick?: ((path: string) => void) | null;
  /** fires when the user clicks the project button in the header */
  onSwitchSource?: () => void;
  /** Fires when the user clicks the reset-view (gem) button in the header
   *  (far left). Mirrors the R keyboard shortcut and clicking the gem in
   *  the city. Caller must pass the same mode-aware reset function used by
   *  the canvas-side input handlers, so all entry points stay consistent. */
  onResetView?: () => void;
  /** fires when the user clicks the focus button next to the selected path —
   *  mirrors pressing F on the canvas. Caller looks at the current selection
   *  and calls rig.focusBuilding / rig.focusStreet as appropriate. */
  onFocus?: () => void;
  /** Branch name when the loaded source is a git URL with an explicit branch. */
  branch?: string;
  /** Original src URL when the loaded source is a git URL — used to render the open-repo link next to the project button. */
  sourceUrl?: string;
}

/**
 * Initialise the sitewide header. Layout (left → right):
 *   reset-view (gem) icon button   — far left
 *   project button (icon + label + @branch pill)
 *   repo link icon (if git url)
 *   #app-title slot (chip + path segments + copy) — empty at root
 *
 * The path-badge subscribes to BUILDING_PALETTE + ASPHALT so changing an
 * extension hue or the asphalt color in Controls live-repaints the badge.
 */
export function initAppHeader(opts: InitAppHeaderOpts = {}) {
  const {
    rootLabel = '',
    rootPath = '',
    onSegmentClick = null,
    onSwitchSource,
    onResetView,
    onFocus,
  } = opts;

  const titleEl = document.getElementById('app-title');
  if (!titleEl) {
    return {
      setSelection(_sel: HeaderSelection | null) {},
      setSourceInfo(_rootLabel?: string, _branch?: string, _sourceUrl?: string) {},
    };
  }

  // Far-left controls (gem, project chip, repo link) live in this wrapper
  // so the header's grid layout can balance the left/right tracks and keep
  // #app-title visually centered. Fall back to the header element itself
  // if the wrapper isn't present (older shells / test fixtures).
  const leftEl: HTMLElement = document.getElementById('app-header-left') ?? titleEl.parentElement!;

  // Idempotency guard: if initAppHeader has run before, clear our
  // previously-injected buttons so we don't accumulate stacked copies
  // on error-path re-init (boot() catch path → startRenderLoop again).
  leftEl.querySelectorAll('[data-app-header-injected]').forEach((el) => el.remove());

  // Last selection cached so config-store subscriptions can re-render
  // with the same selection when the palette / asphalt color changes.
  let lastSelection: HeaderSelection | null = null;

  // Module-level refs for the ResizeObserver — updated on every setSelection.
  let _crumbsEl: HTMLElement | null = null;
  let _segEls: HTMLElement[] = [];
  let _sepEls: HTMLElement[] = [];

  const _resizeObserver = new ResizeObserver(() => {
    if (_crumbsEl) fitSegments(_crumbsEl, _segEls, _sepEls);
  });
  // Observe the whole header row so sidebar-resize and window-resize both trigger.
  if (titleEl.parentElement) {
    _resizeObserver.observe(titleEl.parentElement);
  }

  // Current branch — updated by setSourceInfo after mid-session source switches.
  let _branch = opts.branch;
  let _sourceUrl = opts.sourceUrl;
  let _repoLinkEl: HTMLAnchorElement | null = null;

  // Project button — rendered once and mutated by setSourceInfo.
  let _projectBtn: HTMLButtonElement | null = null;
  let _projectLabelEl: HTMLSpanElement | null = null;
  let _branchPillEl: HTMLSpanElement | null = null;
  // Mutable root label — re-derived from each manifest on source switch.
  let _rootLabel = rootLabel;

  /**
   * Render the title slot for a selection.
   *
   * sel shape:
   *   null                               → #app-title is EMPTY
   *   { path, extension, isDir }         → chip + breadcrumb + copy
   *
   * The chip leads the breadcrumb. The root segment and branch pill are
   * now in the project button on the far left — NOT inside #app-title.
   */
  function setSelection(sel: HeaderSelection | null): void {
    lastSelection = sel;
    titleEl!.replaceChildren();
    if (!sel) {
      return;
    }

    // Focus button — shared across all kinds.
    if (onFocus) {
      const focusBtn = document.createElement('button');
      focusBtn.type = 'button';
      focusBtn.className = 'btn-icon btn-icon--no-drag';
      const tooltip =
        sel.kind === 'commit' ? 'Focus camera on commit (F)' : 'Focus camera on selection (F)';
      focusBtn.title = tooltip;
      focusBtn.setAttribute('aria-label', tooltip);
      focusBtn.appendChild(makeLucideIcon('focus'));
      focusBtn.addEventListener('click', () => onFocus());
      titleEl!.appendChild(focusBtn);
    }

    if (sel.kind === 'commit') {
      // "Commit <short-sha> · <primary>[ (+N)]" with copy-full-sha button.
      const label = document.createTextNode('Commit ');
      titleEl!.appendChild(label);
      const shaEl = document.createElement('span');
      shaEl.className = 'app-header-commit-sha';
      shaEl.textContent = sel.sha.slice(0, 7);
      titleEl!.appendChild(shaEl);
      const authorEl = document.createElement('span');
      authorEl.className = 'app-header-commit-author';
      const primary = sel.authors[0] || '(unknown)';
      const coAuthorCount = Math.max(0, sel.authors.length - 1);
      authorEl.textContent =
        coAuthorCount > 0 ? ` · ${primary} (+${coAuthorCount})` : ` · ${primary}`;
      titleEl!.appendChild(authorEl);
      titleEl!.appendChild(_makeCopyButton(sel.sha));
      _crumbsEl = null;
      _segEls = [];
      _sepEls = [];
      return;
    }

    // file | dir branch — unchanged from previous implementation.
    const hasSel = !!(sel.path && sel.path !== rootPath);
    if (!hasSel) return;

    // Chip mirrors the leaf: file-ext when a file is selected, dir badge
    // for any directory selection. Palette + asphalt are read fresh from
    // the stores so the badge follows live config edits.
    const isFileSel = !sel.isDir;
    const huePalette = BUILDING_PALETTE.get().HUE_EXT_MAP || {};
    const asphaltColor = ASPHALT.get().COLOR;
    titleEl!.appendChild(
      makeExtensionBadge(
        isFileSel ? (sel.extension ?? null) : null,
        !isFileSel,
        huePalette,
        asphaltColor
      )
    );

    const crumbs = document.createElement('div');
    crumbs.className = 'app-header-crumbs';
    crumbs.title = `${_rootLabel}/${sel.path}`;

    const segs = sel.path.split('/').filter(Boolean);
    const segmentEls: HTMLElement[] = [];
    const separatorEls: HTMLElement[] = [];
    let acc = '';
    for (let i = 0; i < segs.length; i++) {
      acc = acc ? `${acc}/${segs[i]}` : segs[i];
      const isLeaf = i === segs.length - 1;
      if (i > 0) {
        const sep = document.createElement('span');
        sep.className = 'app-header-sep';
        sep.textContent = '›';
        separatorEls.push(sep);
        crumbs.appendChild(sep);
      }
      const segEl = _makeSegment(segs[i], acc, isLeaf);
      segmentEls.push(segEl);
      crumbs.appendChild(segEl);
    }
    titleEl!.appendChild(crumbs);
    titleEl!.appendChild(_makeCopyButton(sel.fullPath || sel.path));

    _crumbsEl = crumbs;
    _segEls = segmentEls;
    _sepEls = separatorEls;
    fitSegments(_crumbsEl, _segEls, _sepEls);
  }

  /**
   * Update the project label + branch pill inside the project button after
   * a mid-session source switch. Re-renders with the current cached
   * selection so the header reflects the new source immediately.
   *
   * Either argument can be omitted to leave that field unchanged. Pass
   * `null` to explicitly clear (e.g., `branch: null` removes the pill).
   */
  function _syncRepoLink(): void {
    if (_sourceUrl && _projectBtn?.parentElement) {
      if (!_repoLinkEl) {
        const a = document.createElement('a');
        a.className = 'btn-icon btn-icon--link btn-icon--no-drag';
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.setAttribute('aria-label', 'Open repository in a new tab');
        a.appendChild(makeLucideIcon('external-link'));
        a.dataset.appHeaderInjected = '1';
        _repoLinkEl = a;
        // Inserts directly after the project button, inside #app-header-left.
        _projectBtn.parentElement.insertBefore(_repoLinkEl, _projectBtn.nextSibling);
      }
      const baseUrl = toHttpsRepoUrl(_sourceUrl);
      const url = _branch ? _withBranchPath(baseUrl, _branch) : baseUrl;
      _repoLinkEl.href = url;
      _repoLinkEl.title = _branch ? `Open repo at @${_branch}` : `Open repo: ${_sourceUrl}`;
    } else if (_repoLinkEl) {
      _repoLinkEl.remove();
      _repoLinkEl = null;
    }
  }

  function setSourceInfo(rootLabel?: string, branch?: string, sourceUrl?: string): void {
    if (typeof rootLabel === 'string') {
      _rootLabel = rootLabel;
      if (_projectLabelEl) _projectLabelEl.textContent = _rootLabel;
    }

    // First-time project load: create the button now that we have
    // something to show. The button stays hidden on cold boot (when
    // _rootLabel is empty) so the header doesn't have an empty chip
    // dangling next to the gem.
    if (!_projectBtn && _rootLabel) {
      _createProjectButton();
    }

    _branch = branch;
    if (_projectBtn) {
      if (_branchPillEl) {
        _branchPillEl.remove();
        _branchPillEl = null;
      }
      if (_branch) {
        _branchPillEl = document.createElement('span');
        _branchPillEl.className = 'app-header-branch-pill';
        _branchPillEl.textContent = `@${_branch}`;
        _projectBtn.appendChild(_branchPillEl);
      }
    }

    _sourceUrl = sourceUrl;
    _syncRepoLink();

    setSelection(lastSelection);
  }

  function _makeSegment(label: string, path: string, isLeaf: boolean): HTMLButtonElement {
    const seg = document.createElement('button');
    seg.type = 'button';
    seg.className = 'btn-icon btn-icon--text btn-icon--no-drag';
    if (isLeaf) seg.classList.add('is-leaf');
    seg.textContent = label;
    seg.addEventListener('click', () => {
      if (onSegmentClick) onSegmentClick(path);
    });
    return seg;
  }

  function _makeCopyButton(path: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-icon btn-icon--no-drag';
    btn.title = 'Copy path';
    btn.setAttribute('aria-label', 'Copy path');
    btn.appendChild(makeLucideIcon('copy'));
    btn.addEventListener('click', () => {
      _copy(path, btn);
    });
    return btn;
  }

  // Project button — sits at the far left of the header row, prepended
  // before the title/breadcrumb slot. Contains: icon + project label +
  // branch pill. Created lazily so the header stays clean on cold boot
  // (no project loaded → no empty chip dangling next to the gem).
  function _createProjectButton(): void {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-chip';
    btn.title = 'Switch project';
    btn.setAttribute('aria-label', 'Switch project');
    btn.appendChild(makeLucideIcon('map'));

    _projectLabelEl = document.createElement('span');
    _projectLabelEl.className = 'btn-chip-label';
    _projectLabelEl.textContent = _rootLabel;
    btn.appendChild(_projectLabelEl);

    if (_branch) {
      _branchPillEl = document.createElement('span');
      _branchPillEl.className = 'app-header-branch-pill';
      _branchPillEl.textContent = `@${_branch}`;
      btn.appendChild(_branchPillEl);
    }

    // Chevron at the end signals the chip is interactive (opens picker).
    btn.appendChild(makeLucideIcon('chevron-down', { class: 'btn-chip-chevron' }));

    if (onSwitchSource) {
      btn.addEventListener('click', () => onSwitchSource());
    } else {
      btn.disabled = true;
    }

    _projectBtn = btn;
    btn.dataset.appHeaderInjected = '1';
    // Appended to the left wrapper so the order is [gem][project][(link)],
    // which keeps the gem (prepended below) as the first child.
    leftEl.appendChild(btn);

    // Render the open-repo link IMMEDIATELY AFTER the project button if a
    // git source URL was set. _syncRepoLink relies on _projectBtn being
    // inserted into the DOM (it positions the link via .nextSibling), so
    // this call must happen after the insert above.
    _syncRepoLink();
  }

  // Only render the button at init if there's already a project loaded —
  // otherwise wait for setSourceInfo() to fire on first manifest.
  if (_rootLabel) {
    _createProjectButton();
  }

  // Reset-view button — sits at the FAR LEFT of the header row, prepended
  // before the project button. Same action as the R keyboard shortcut
  // and as clicking the gem in the city: reset the camera view. Does NOT
  // rebuild the city — reload the page for that.
  if (onResetView) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-icon btn-icon--no-drag';
    btn.title = 'Reset view (R)';
    btn.setAttribute('aria-label', 'Reset view');
    btn.appendChild(makeGemIcon());
    btn.dataset.appHeaderInjected = '1';
    btn.addEventListener('click', () => onResetView());
    leftEl.prepend(btn);
  }

  // Live config: re-render the cached selection whenever a store that
  // feeds the badge changes. Nanostores fire .subscribe() synchronously
  // with the current value at hook-up time; we drop that first call so
  // we don't double-render before the host has set an initial selection.
  let _ready = false;
  const _reRender = () => {
    if (_ready) setSelection(lastSelection);
  };
  BUILDING_PALETTE.subscribe(_reRender);
  ASPHALT.subscribe(_reRender);
  _ready = true;

  return {
    setSelection,
    setSourceInfo,
  };
}

function _copy(text: string, btn: HTMLButtonElement): void {
  function flash() {
    if (!btn) return;
    btn.classList.add('is-copied');
    setTimeout(() => {
      btn.classList.remove('is-copied');
    }, COPY_FEEDBACK_DURATION_MS);
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(flash, () => {
      _legacyCopy(text);
      flash();
    });
  } else {
    _legacyCopy(text);
    flash();
  }
}

/**
 * Append a branch-tree path to a forge HTTPS URL so the external-link
 * icon opens the branch instead of the repo root. Path conventions
 * vary by forge:
 *   github.com / sr.ht                       → /tree/<branch>
 *   gitlab.com                               → /-/tree/<branch>
 *   bitbucket.org                            → /src/<branch>
 *   codeberg.org + Forgejo + Gitea hosts     → /src/branch/<branch>
 *
 * Self-hosted Forgejo / Gitea instances live on arbitrary hostnames;
 * we match by the host containing "forgejo" or "gitea" as a best-effort
 * shorthand (works for e.g. forgejo.example.com or git.gitea.io, but
 * not for fully-renamed instances). When nothing matches, return the
 * base URL — better to land on the repo than to ship a broken 404.
 */
function _withBranchPath(repoHttpsUrl: string, branch: string): string {
  const ref = encodeURIComponent(branch);
  if (/codeberg\.org|forgejo|gitea/i.test(repoHttpsUrl)) {
    return `${repoHttpsUrl}/src/branch/${ref}`;
  }
  if (/github\.com|sr\.ht/i.test(repoHttpsUrl)) {
    return `${repoHttpsUrl}/tree/${ref}`;
  }
  if (/gitlab\.com/i.test(repoHttpsUrl)) {
    return `${repoHttpsUrl}/-/tree/${ref}`;
  }
  if (/bitbucket\.org/i.test(repoHttpsUrl)) {
    return `${repoHttpsUrl}/src/${ref}`;
  }
  return repoHttpsUrl;
}

function _legacyCopy(text: string): void {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try {
    document.execCommand('copy');
  } catch (_) {
    /* fallback unavailable */
  }
  document.body.removeChild(ta);
}
