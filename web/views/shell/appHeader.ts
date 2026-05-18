// views/shell/appHeader.ts — Sitewide top header. Layout (left → right):
//   refresh (gem) icon button   — far left
//   project button (icon + label + @branch pill) → opens source picker
//   repo link icon (if git url)
//   #app-title slot: chip + path breadcrumb + copy button   — center
//   fly-mode toggle button   — far right
//
// When no path is selected (or only the root), #app-title is empty.

import { ASPHALT, BUILDING_PALETTE } from '@/config';
import { makeLucideIcon } from './icon.js';
import { makeExtensionBadge } from './badge.js';
import { toHttpsRepoUrl } from './displayLabel.js';
import { fitSegments } from './pathTruncate.js';

// How long the "Copied!" badge lingers after the copy button is clicked.
const COPY_FEEDBACK_DURATION_MS = 1500;

interface HeaderSelection {
  path: string;
  fullPath?: string;
  extension?: string;
  isDir?: boolean;
}

interface InitAppHeaderOpts {
  /** project name shown in the project button on the left */
  rootLabel?: string;
  /** the path string the segment-click handler should receive when the root is clicked (e.g. "." or "") */
  rootPath?: string;
  /** fn(path:string) — fires when the user clicks a breadcrumb segment. Caller selects the matching node. */
  onSegmentClick?: ((path: string) => void) | null;
  /** fires when the user clicks the project button in the header */
  onSwitchSource?: () => void;
  /** fires when the user clicks the refresh button in the header (far left) */
  onRefresh?: () => void;
  /** fires when the user clicks the focus button next to the selected path —
   *  mirrors pressing F on the canvas. Caller looks at the current selection
   *  and calls rig.focusBuilding / rig.focusStreet as appropriate. */
  onFocus?: () => void;
  /** Fires when the user clicks the fly-mode toggle button. */
  onToggleFly?: () => void;
  /** Branch name when the loaded source is a git URL with an explicit branch. */
  branch?: string;
  /** Original src URL when the loaded source is a git URL — used to render the open-repo link next to the project button. */
  sourceUrl?: string;
}

/**
 * Initialise the sitewide header. Layout (left → right):
 *   refresh (gem) icon button   — far left
 *   project button (icon + label + @branch pill)
 *   repo link icon (if git url)
 *   #app-title slot (chip + path segments + copy) — empty at root
 *   fly-mode toggle button   — far right
 *
 * The path-badge subscribes to BUILDING_PALETTE + ASPHALT so changing an
 * extension hue or the asphalt color in Controls live-repaints the badge.
 */
export function initAppHeader(opts: InitAppHeaderOpts = {}) {
  const { rootLabel = '', rootPath = '', onSegmentClick = null, onSwitchSource, onRefresh, onFocus, onToggleFly } = opts;

  const titleEl = document.getElementById('app-title');
  if (!titleEl) {
    return {
      setSelection(_sel: HeaderSelection | null) {},
      setSourceInfo(_rootLabel?: string, _branch?: string, _sourceUrl?: string) {},
      setFlyActive(_active: boolean) {},
    };
  }

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
    const hasSel = !!(sel?.path && sel.path !== rootPath);

    if (!hasSel) {
      // Empty title — project button on the left carries the project identity.
      return;
    }

    // Focus button — fires F-key equivalent (focus camera on selection).
    // Sits LEFT of the extension badge so the order reads
    // [focus] [ext tag] [path] [copy].
    if (onFocus) {
      const focusBtn = document.createElement('button');
      focusBtn.type = 'button';
      focusBtn.className = 'btn-icon btn-icon--no-drag';
      focusBtn.title = 'Focus camera on selection (F)';
      focusBtn.setAttribute('aria-label', 'Focus camera on selection');
      focusBtn.appendChild(makeLucideIcon('focus'));
      focusBtn.addEventListener('click', () => onFocus());
      titleEl!.appendChild(focusBtn);
    }

    // Chip mirrors the leaf: file-ext when a file is selected, dir badge
    // for any directory selection. Palette + asphalt are read fresh from
    // the stores so the badge follows live config edits.
    const isFileSel = sel && !sel.isDir;
    const huePalette = BUILDING_PALETTE.get().HUE_EXT_MAP || {};
    const asphaltColor = ASPHALT.get().COLOR;
    titleEl!.appendChild(
      makeExtensionBadge(
        isFileSel ? (sel!.extension ?? null) : null,
        !isFileSel,
        huePalette,
        asphaltColor
      )
    );

    const crumbs = document.createElement('div');
    crumbs.className = 'app-header-crumbs';
    crumbs.title = sel ? `${_rootLabel}/${sel.path}` : _rootLabel;

    // Path segments — the root is in the project button, so we start
    // directly with the selection's path segments.
    const segs = sel!.path.split('/').filter(Boolean);
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

    // Copy button copies the absolute filesystem path.
    titleEl!.appendChild(_makeCopyButton(sel!.fullPath || sel!.path));

    // Cache refs for ResizeObserver and run initial fit.
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
        _repoLinkEl = a;
        _projectBtn.parentElement.insertBefore(_repoLinkEl, _projectBtn.nextSibling);
      }
      _repoLinkEl.href = toHttpsRepoUrl(_sourceUrl);
      _repoLinkEl.title = `Open repo: ${_sourceUrl}`;
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
  // before the title/breadcrumb slot. Contains: icon + project label + branch pill.
  {
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
    titleEl.parentElement?.prepend(btn);

    // Render the open-repo link IMMEDIATELY AFTER the project button if a
    // git source URL was passed at init. _syncRepoLink relies on _projectBtn
    // being inserted into the DOM (it positions the link via .nextSibling),
    // so this call must happen after the prepend above.
    _syncRepoLink();
  }

  // Refresh button — sits at the FAR LEFT of the header row, prepended
  // before the project button. Same action as the R keyboard shortcut
  // and as clicking the gem in the city: rebuild the manifest and
  // reset the camera view.
  if (onRefresh) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-icon btn-icon--no-drag btn-icon--rainbow';
    btn.title = 'Refresh — rebuild the city and reset the view (R)';
    btn.setAttribute('aria-label', 'Refresh');
    btn.appendChild(makeLucideIcon('gem'));
    btn.addEventListener('click', () => onRefresh());
    titleEl.parentElement?.prepend(btn);
  }

  // Fly-mode toggle button — appended (not prepended) to the header parent
  // so it lands at the right edge via flexbox. The icon swaps with the
  // mode: compass when orbiting (you're navigating around the city),
  // plane when flying (you're navigating through it). The active state
  // mirrors flyControls.isActive() and is updated via setFlyActive()
  // (called from coordinator on every onActiveChange) so V-key toggles
  // stay in sync with the button.
  let _flyBtn: HTMLButtonElement | null = null;
  if (onToggleFly) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-icon btn-icon--no-drag';
    btn.title = 'Enter fly mode (V)';
    btn.setAttribute('aria-label', 'Toggle fly mode');
    btn.appendChild(makeLucideIcon('compass'));
    btn.addEventListener('click', () => onToggleFly());
    titleEl.parentElement?.appendChild(btn);
    _flyBtn = btn;
  }

  function setFlyActive(active: boolean): void {
    if (!_flyBtn) return;
    _flyBtn.classList.toggle('is-active', active);
    _flyBtn.title = active ? 'Exit fly mode (V)' : 'Enter fly mode (V)';
    // Swap the icon: plane while flying, compass while orbiting.
    _flyBtn.replaceChildren(makeLucideIcon(active ? 'plane' : 'compass'));
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
    setFlyActive,
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
