// views/shell/appHeader.ts — Sitewide top header. Renders the current
// selection as a breadcrumb (chip + clickable path segments + copy-path
// button). No side buttons — navigation actions (camera reset) live in
// the footer; the activity bar on the left sidebar handles sidebar
// collapse on its own.

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
  /** project name shown as the leftmost breadcrumb segment (clicking it selects the project root) */
  rootLabel?: string;
  /** the path string the segment-click handler should receive when the root is clicked (e.g. "." or "") */
  rootPath?: string;
  /** fn(path:string) — fires when the user clicks a breadcrumb segment. Caller selects the matching node. */
  onSegmentClick?: ((path: string) => void) | null;
  /** fires when the user clicks the switch-source button in the header */
  onSwitchSource?: () => void;
}

/**
 * Initialise the sitewide header. Populates the title slot with chip +
 * breadcrumb + copy widgets. The path-badge subscribes to
 * BUILDING_PALETTE + ASPHALT so changing an extension hue or the
 * asphalt color in Controls live-repaints the currently-shown badge.
 */
export function initAppHeader(opts: InitAppHeaderOpts = {}) {
  const { rootLabel = '', rootPath = '', onSegmentClick = null, onSwitchSource } = opts;

  const titleEl = document.getElementById('app-title');
  if (!titleEl) {
    return {
      setSelection(_sel: HeaderSelection | null) {},
    };
  }

  // Last selection cached so config-store subscriptions can re-render
  // with the same selection when the palette / asphalt color changes.
  let lastSelection: HeaderSelection | null = null;

  /**
   * Render the title slot for a selection.
   *
   * sel shape:
   *   null                                   → just the root segment (the
   *                                            project name) with a dir chip
   *   { path, extension, isDir }             → chip + breadcrumb + copy
   *
   * The breadcrumb is always prefixed by the root segment (clickable —
   * fires onSegmentClick with rootPath). When sel is null we show only
   * the root.
   */
  function setSelection(sel: HeaderSelection | null): void {
    lastSelection = sel;
    titleEl!.replaceChildren();
    const hasSel = !!(sel?.path && sel.path !== rootPath);

    // Chip mirrors the leaf: file-ext when a file is selected, dir badge
    // for the root or any directory selection. Palette + asphalt are
    // read fresh from the stores so the badge follows live config edits.
    const isFileSel = hasSel && sel && !sel.isDir;
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
    crumbs.title = hasSel && sel ? `${rootLabel}/${sel.path}` : rootLabel;

    // Always lead with the root.
    crumbs.appendChild(_makeSegment(rootLabel || '/', rootPath, !hasSel));

    if (hasSel && sel) {
      const segs = sel.path.split('/').filter(Boolean);
      let acc = '';
      for (let i = 0; i < segs.length; i++) {
        acc = acc ? `${acc}/${segs[i]}` : segs[i];
        const isLeaf = i === segs.length - 1;
        const sep = document.createElement('span');
        sep.className = 'app-header-sep';
        sep.textContent = '›';
        crumbs.appendChild(sep);
        crumbs.appendChild(_makeSegment(segs[i], acc, isLeaf));
      }
    }
    titleEl!.appendChild(crumbs);

    if (hasSel && sel) {
      // Copy button copies the absolute filesystem path so users can
      // paste it into a terminal / editor; the breadcrumb display
      // stays project-relative for readability.
      titleEl!.appendChild(_makeCopyButton(sel.fullPath || sel.path));
    }
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

  // Switch-source button — sits in the header row next to the title slot.
  // Rendered once outside setSelection because it doesn't depend on the
  // current breadcrumb selection; it just needs to exist alongside it.
  if (onSwitchSource) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'switch-source-btn';
    btn.title = 'Switch source';
    btn.setAttribute('aria-label', 'Switch source');
    btn.textContent = '⟳';
    btn.addEventListener('click', () => onSwitchSource());
    titleEl.parentElement?.appendChild(btn);
  }

  // Live config: re-render the cached selection whenever a store that
  // feeds the badge changes — the user editing an extension hue or the
  // asphalt color in Controls should be visible immediately. Nanostores
  // fire .subscribe() synchronously with the current value at hook-up
  // time; we drop that first call so we don't double-render before the
  // host has set an initial selection.
  let _ready = false;
  const _reRender = () => {
    if (_ready) setSelection(lastSelection);
  };
  BUILDING_PALETTE.subscribe(_reRender);
  ASPHALT.subscribe(_reRender);
  _ready = true;

  return {
    setSelection,
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
