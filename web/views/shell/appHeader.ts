// views/shell/appHeader.ts — Sitewide top header. Three zones:
//   left   — project button (icon + label + @branch pill) → opens source picker
//   center — #app-title slot: chip + path breadcrumb + copy button
//   right  — refresh icon button
//
// When no path is selected (or only the root), #app-title is empty.

import { ASPHALT, BUILDING_PALETTE } from '@/config';
import { makeLucideIcon } from './icon.js';
import { makeExtensionBadge } from './badge.js';

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
  /** fires when the user clicks the refresh button in the header (far right) */
  onRefresh?: () => void;
  /** Branch name when the loaded source is a git URL with an explicit branch. */
  branch?: string;
}

/**
 * Initialise the sitewide header. The header has three zones:
 *   left   — project button (icon + label + @branch pill)
 *   center — #app-title slot (chip + path segments + copy) — empty at root
 *   right  — refresh button
 *
 * The path-badge subscribes to BUILDING_PALETTE + ASPHALT so changing an
 * extension hue or the asphalt color in Controls live-repaints the badge.
 */
export function initAppHeader(opts: InitAppHeaderOpts = {}) {
  const { rootLabel = '', rootPath = '', onSegmentClick = null, onSwitchSource, onRefresh } = opts;

  const titleEl = document.getElementById('app-title');
  if (!titleEl) {
    return {
      setSelection(_sel: HeaderSelection | null) {},
      setSourceInfo(_rootLabel?: string, _branch?: string) {},
    };
  }

  // Last selection cached so config-store subscriptions can re-render
  // with the same selection when the palette / asphalt color changes.
  let lastSelection: HeaderSelection | null = null;

  // Current branch — updated by setSourceInfo after mid-session source switches.
  let _branch = opts.branch;

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
    let acc = '';
    for (let i = 0; i < segs.length; i++) {
      acc = acc ? `${acc}/${segs[i]}` : segs[i];
      const isLeaf = i === segs.length - 1;
      if (i > 0) {
        const sep = document.createElement('span');
        sep.className = 'app-header-sep';
        sep.textContent = '›';
        crumbs.appendChild(sep);
      }
      crumbs.appendChild(_makeSegment(segs[i], acc, isLeaf));
    }
    titleEl!.appendChild(crumbs);

    // Copy button copies the absolute filesystem path.
    titleEl!.appendChild(_makeCopyButton(sel!.fullPath || sel!.path));
  }

  /**
   * Update the project label + branch pill inside the project button after
   * a mid-session source switch. Re-renders with the current cached
   * selection so the header reflects the new source immediately.
   *
   * Either argument can be omitted to leave that field unchanged. Pass
   * `null` to explicitly clear (e.g., `branch: null` removes the pill).
   */
  function setSourceInfo(rootLabel?: string, branch?: string): void {
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
    setSelection(lastSelection);
  }

  function _makeSegment(label: string, path: string, isLeaf: boolean): HTMLButtonElement {
    const seg = document.createElement('button');
    seg.type = 'button';
    seg.className = 'app-header-segment';
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
    btn.className = 'app-header-icon';
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
    btn.className = 'project-btn';
    btn.title = 'Switch project';
    btn.setAttribute('aria-label', 'Switch project');
    btn.appendChild(makeLucideIcon('map'));

    _projectLabelEl = document.createElement('span');
    _projectLabelEl.className = 'project-btn-label';
    _projectLabelEl.textContent = _rootLabel;
    btn.appendChild(_projectLabelEl);

    if (_branch) {
      _branchPillEl = document.createElement('span');
      _branchPillEl.className = 'app-header-branch-pill';
      _branchPillEl.textContent = `@${_branch}`;
      btn.appendChild(_branchPillEl);
    }

    if (onSwitchSource) {
      btn.addEventListener('click', () => onSwitchSource());
    } else {
      btn.disabled = true;
    }

    _projectBtn = btn;
    titleEl.parentElement?.prepend(btn);
  }

  // Refresh button — sits at the far right of the header row, appended
  // after all other header content.
  if (onRefresh) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'app-header-refresh-btn';
    btn.title = 'Refresh — rebuild the city and reset the view';
    btn.setAttribute('aria-label', 'Refresh');
    btn.appendChild(makeLucideIcon('map-pin-house'));
    btn.addEventListener('click', () => onRefresh());
    titleEl.parentElement?.appendChild(btn);
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
