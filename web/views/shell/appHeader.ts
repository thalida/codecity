// views/shell/appHeader.ts — Sitewide top header. Owns the current-
// selection display (chip + clickable breadcrumb + copy-path button)
// in the center, an "Up one level" navigation button on the left, and
// a "Reset view" camera-reset button on the right.
//
// The two side buttons replaced the older "hide left sidebar" / "hide
// right sidebar" toggles — the right sidebar now self-manages via its
// own × close button, and the left sidebar has its own activity-bar
// collapse, so the dedicated hide-toggles in the header were redundant.

import { getHue } from '@/scene/colors.js';
import { makeLucideIcon } from './icon.js';

// How long the "Copied!" badge lingers after the copy button is clicked.
const COPY_FEEDBACK_DURATION_MS = 1500;

interface HeaderSelection {
  path: string;
  fullPath?: string;
  extension?: string;
  isDir?: boolean;
}

interface InitAppHeaderOpts {
  /** extension → hue map for the chip color */
  huePalette?: Record<string, number>;
  /** project name shown as the leftmost breadcrumb segment (clicking it selects the project root) */
  rootLabel?: string;
  /** the path string the segment-click handler should receive when the root is clicked (e.g. "." or "") */
  rootPath?: string;
  /** fn(path:string) — fires when the user clicks a breadcrumb segment. Caller selects the matching node. */
  onSegmentClick?: ((path: string) => void) | null;
  /** fn() — fires when the user clicks the "Up one level" button. Caller resolves the parent path of the current selection and selects it. */
  onUp?: (() => void) | null;
  /** fn() — fires when the user clicks the "Reset view" button. Caller resets the camera (same as the R key). */
  onResetView?: (() => void) | null;
}

/**
 * Initialise the sitewide header. Renders icons into the existing buttons
 * in index.html, populates the title slot with chip + breadcrumb + copy
 * widgets. The Up button's enabled state tracks the current selection
 * (disabled when nothing is selected or the selection is the root).
 */
export function initAppHeader(opts: InitAppHeaderOpts = {}) {
  const {
    huePalette = {},
    rootLabel = '',
    rootPath = '',
    onSegmentClick = null,
    onUp = null,
    onResetView = null,
  } = opts;

  const upBtn = document.getElementById('app-header-up') as HTMLButtonElement | null;
  const resetBtn = document.getElementById('app-header-reset') as HTMLButtonElement | null;
  const titleEl = document.getElementById('app-title');
  if (!upBtn || !resetBtn || !titleEl) {
    return {
      setSelection(_sel: HeaderSelection | null) {},
    };
  }

  upBtn.replaceChildren(makeLucideIcon('arrow-up'));
  resetBtn.replaceChildren(makeLucideIcon('refresh-cw'));

  upBtn.addEventListener('click', () => {
    if (upBtn.disabled) return;
    if (onUp) onUp();
  });
  resetBtn.addEventListener('click', () => {
    if (onResetView) onResetView();
  });

  function _setUpEnabled(enabled: boolean): void {
    upBtn!.disabled = !enabled;
  }
  // No selection on boot — Up has nothing to navigate to until the user
  // selects something.
  _setUpEnabled(false);

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
    titleEl!.replaceChildren();
    const hasSel = !!(sel?.path && sel.path !== rootPath);
    _setUpEnabled(hasSel);

    // Chip mirrors the leaf: file-ext when a file is selected, dir badge
    // for the root or any directory selection.
    if (hasSel && sel && !sel.isDir) {
      titleEl!.appendChild(_makeChip(sel.extension ?? null, false));
    } else {
      titleEl!.appendChild(_makeChip(null, true));
    }

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

  function _makeChip(extension: string | null, isDir: boolean): HTMLSpanElement {
    const chip = document.createElement('span');
    chip.className = 'app-header-chip';
    if (isDir) {
      chip.classList.add('is-dir');
      chip.textContent = 'dir';
    } else {
      chip.textContent = (extension || '').replace(/^\./, '').slice(0, 4) || 'file';
      chip.style.setProperty('--badge-hue', String(getHue(extension, huePalette)));
    }
    return chip;
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
