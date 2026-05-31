// views/shell/rightSidebar.tsx — chrome for the right-side panel. Owns:
//   - the .open class that drives the open/close transition
//   - the drag-to-resize handle on the inside (left) edge
//   - persisting the chosen width across reloads
//   - mounting one pane element into the slot
//
// Exactly one pane is mounted at a time. The coordinator builds a pane
// (filePreviewPane today) and hands it in via showRightSidebar(pane).
// Subsequent calls with the same pane reference are no-ops; passing a
// different pane swaps it. Body-level rendering lives in the pane, not
// here — see views/panes/filePreviewPane.tsx.

import { effect } from '@preact/signals';
import type { ReadonlySignal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { DOM_IDS, STORAGE_KEYS } from '@/constants';
import { NodeKind } from '@/types';
import { SCENE_HANDLE } from '@/state/runtime/scene';
import { buildFilePreviewPane } from '@/views/panes/FilePreviewPane';
import { buildCommitPane } from '@/views/panes/CommitPane';
import { buildStreetPane } from '@/views/panes/StreetPane';
import { sameDayCommitCount, dailyCommitThresholds } from '@/utils/commit';

// Persistent width range (in px) for the right sidebar drag handle.
const SIDEBAR_MIN_WIDTH = 280;
const SIDEBAR_MAX_WIDTH_RATIO = 0.7; // fraction of viewport width

// ── State shape for Preact component ─────────────────────────────────────────

export interface RightSidebarState {
  isOpen: boolean;
  pane: HTMLElement | null;
}

// ── Resize handle helpers ─────────────────────────────────────────────────────

function _ensureResizeHandle(sidebar: HTMLElement): void {
  if (sidebar.querySelector('.sidebar-resize-handle-right')) return;

  const handle = document.createElement('div');
  handle.className = 'sidebar-resize-handle-right';
  handle.setAttribute('role', 'separator');
  handle.setAttribute('aria-orientation', 'vertical');
  handle.title = 'Drag to resize';

  let dragging = false;
  let liveWidth = 0;

  handle.addEventListener('pointerdown', (e) => {
    dragging = true;
    handle.classList.add('dragging');
    handle.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  handle.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    let w = window.innerWidth - e.clientX;
    const maxW = Math.floor(window.innerWidth * SIDEBAR_MAX_WIDTH_RATIO);
    if (w < SIDEBAR_MIN_WIDTH) w = SIDEBAR_MIN_WIDTH;
    if (w > maxW) w = maxW;
    liveWidth = w;
    sidebar.style.setProperty('--sidebar-width', `${w}px`);
  });
  handle.addEventListener('pointerup', (e) => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    handle.releasePointerCapture(e.pointerId);
    _persistWidth(liveWidth || sidebar.offsetWidth);
  });

  sidebar.appendChild(handle);
}

function _applyPersistedWidth(sidebar: HTMLElement): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.FILE_SIDEBAR_WIDTH);
    if (raw == null) return;
    let w = parseFloat(raw);
    if (!Number.isFinite(w)) return;
    const maxW = Math.floor(window.innerWidth * SIDEBAR_MAX_WIDTH_RATIO);
    if (w < SIDEBAR_MIN_WIDTH) w = SIDEBAR_MIN_WIDTH;
    if (w > maxW) w = maxW;
    sidebar.style.setProperty('--sidebar-width', `${w}px`);
  } catch (_) {
    /* private mode / no storage — fall back to CSS default */
  }
}

function _persistWidth(w: number): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEYS.FILE_SIDEBAR_WIDTH, String(w));
  } catch (_) {
    /* drop */
  }
}

// ── DOM helpers ───────────────────────────────────────────────────────────────

function _currentPane(sidebar: HTMLElement): Element | null {
  const children = sidebar.children;
  for (let i = 0; i < children.length; i++) {
    if (!children[i].classList.contains('sidebar-resize-handle-right')) {
      return children[i];
    }
  }
  return null;
}

function _clearMountedPane(sidebar: HTMLElement): void {
  for (const child of [...sidebar.children]) {
    if (!child.classList.contains('sidebar-resize-handle-right')) {
      sidebar.removeChild(child);
    }
  }
}

// ── Shell wrapper — owns the <aside id="right-sidebar"> element ──────────────
// App.tsx renders <RightSidebarShell />, not a bare placeholder div. The
// imperative show/hideRightSidebar + mountRightSidebarReactions still do the
// heavy lifting (resize handle, pane mount, world reactions); this just gives
// the component ownership of its outer DOM node so App.tsx's tree matches
// the rendered hierarchy. Phase 3e will fold the imperative path into this
// component.

export function RightSidebarShell() {
  return <aside id={DOM_IDS.RIGHT_SIDEBAR} />;
}

// ── Preact pane-mount component (used by an in-progress port) ────────────────
// Reads the state signal and applies DOM mutations via useEffect. The factory
// below is the live path today; this component is unused until App.tsx is
// rewritten to drive the right sidebar via a state signal.

interface RightSidebarProps {
  state: ReadonlySignal<RightSidebarState>;
  sidebarEl: HTMLElement;
}

export function RightSidebar({ state, sidebarEl }: RightSidebarProps) {
  const { isOpen, pane } = state.value;

  useEffect(() => {
    sidebarEl.classList.toggle('open', isOpen);
  }, [isOpen, sidebarEl]);

  useEffect(() => {
    _ensureResizeHandle(sidebarEl);
    _applyPersistedWidth(sidebarEl);
    if (pane) {
      const current = _currentPane(sidebarEl);
      if (current !== pane) {
        _clearMountedPane(sidebarEl);
        sidebarEl.appendChild(pane);
      }
    }
  }, [pane, sidebarEl]);

  // No visual output — all changes are imperative DOM mutations on sidebarEl
  return null;
}

// ── Self-subscribing right sidebar reactions ──────────────────────────────────
// Called from App.tsx instead of coordinator.ts. Builds the three panes once
// then subscribes to SCENE_HANDLE + picker.selection to swap panes in response
// to selection changes. Called on app boot; returns a dispose() that stops
// the effects.

export function mountRightSidebarReactions(): () => void {
  type SidebarPane = 'file' | 'commit' | 'street' | null;
  let sidebarPane: SidebarPane = null;

  // Close-button handler shared by every pane: clear the picker selection
  // alongside the local sidebarPane state. Without clearing the selection
  // signal, re-clicking the same building / tree / street wouldn't fire
  // the selection effect below (signals dedupe by reference), and the
  // sidebar would stay closed — confusing UX where "click → close → click
  // same thing" silently does nothing.
  function _closePane(): void {
    sidebarPane = null;
    SCENE_HANDLE.peek()?.picker.clearSelection();
    _renderSidebar();
  }

  const filePreview = buildFilePreviewPane({
    onClose: _closePane,
    onFocus(file) {
      const handle = SCENE_HANDLE.peek();
      if (!handle) return;
      const b = handle.world.getBuildingByPath(file.path);
      if (b) handle.rig.focusBuilding(b.mesh, b.building);
    },
  });

  const commitPane = buildCommitPane({
    onClose: _closePane,
    onFocus(c) {
      const handle = SCENE_HANDLE.peek();
      if (handle) handle.rig.focusTree(c.sha);
    },
  });

  const streetPane = buildStreetPane({
    onClose: _closePane,
    onFocus(d) {
      const handle = SCENE_HANDLE.peek();
      if (!handle) return;
      const st = handle.world.getStreetByDir(d.path);
      if (st) handle.rig.focusStreet(st, null);
    },
  });

  function _renderSidebar(): void {
    const handle = SCENE_HANDLE.peek();
    const sel = handle?.picker.selection.peek() ?? null;
    if (sidebarPane === null) {
      hideRightSidebar();
      return;
    }
    if (sidebarPane === 'file') {
      showRightSidebar(filePreview.pane);
      if (sel && sel.kind === NodeKind.File) filePreview.api.setFile(sel.file);
      else filePreview.api.setFile(null);
      return;
    }
    if (sidebarPane === 'commit') {
      showRightSidebar(commitPane.pane);
      const world = handle?.world;
      const m = world?.getManifest();
      const remote = m?.repo?.remote_url ?? null;
      if (sel && sel.kind === NodeKind.Commit) {
        const commits = m?.commits ?? [];
        const sameDayTotal = sameDayCommitCount(sel.commit, commits);
        const busynessThresholds = dailyCommitThresholds(commits);
        const color = world?.getTrees()?.colorForSha(sel.commit.sha) ?? undefined;
        commitPane.api.setCommit(sel.commit, {
          remoteUrl: remote,
          sameDayTotal,
          busynessThresholds,
          color,
        });
      } else {
        commitPane.api.setCommit(null);
      }
      return;
    }
    if (sidebarPane === 'street') {
      showRightSidebar(streetPane.pane);
      const _sel = sel;
      setTimeout(() => {
        if (_sel && _sel.kind === NodeKind.Directory) {
          streetPane.api.setDirectory(_sel.dir);
        } else {
          streetPane.api.setDirectory(null);
        }
      }, 0);
      return;
    }
  }

  // Subscribe to selection changes. Reading SCENE_HANDLE.value establishes
  // tracking so when the handle is first assigned (CenterPane mount) this
  // effect runs and wires up the selection-based pane choice.
  const _selUnsub = effect(() => {
    const handle = SCENE_HANDLE.value;
    if (!handle) {
      sidebarPane = null;
      hideRightSidebar();
      return;
    }
    const sel = handle.picker.selection.value;
    if (sel && sel.kind === NodeKind.File) sidebarPane = 'file';
    else if (sel && sel.kind === NodeKind.Commit) sidebarPane = 'commit';
    else if (sel && sel.kind === NodeKind.Directory) sidebarPane = 'street';
    else sidebarPane = null;
    _renderSidebar();
  });

  // Subscribe to world.onChange so panes stay fresh on live-update rebuilds.
  const _worldUnsub = effect(() => {
    const handle = SCENE_HANDLE.value;
    if (!handle) return;
    let _unsub: (() => void) | null = null;
    _unsub = handle.world.onChange(() => {
      const sel = handle.picker.selection.peek();
      const m = handle.world.getManifest();
      // Refresh commit pane data when manifest updates while a commit is selected.
      if (sidebarPane === 'commit' && sel?.kind === NodeKind.Commit) {
        const remote = m?.repo?.remote_url ?? null;
        const commits = m?.commits ?? [];
        const sameDayTotal = sameDayCommitCount(sel.commit, commits);
        const busynessThresholds = dailyCommitThresholds(commits);
        const color = handle.world.getTrees()?.colorForSha(sel.commit.sha) ?? undefined;
        commitPane.api.setCommit(sel.commit, {
          remoteUrl: remote,
          sameDayTotal,
          busynessThresholds,
          color,
        });
      }
      // Refresh street pane data when directory is selected and manifest updated.
      if (sidebarPane === 'street' && sel?.kind === NodeKind.Directory) {
        const refreshed = handle.world.getStreetByDir(sel.dir.path);
        const dir = refreshed?.dir ?? sel.dir;
        streetPane.api.setDirectory(dir);
      }
    });
    return () => {
      if (_unsub) _unsub();
    };
  });

  return function dispose() {
    if (typeof _selUnsub === 'function') _selUnsub();
    if (typeof _worldUnsub === 'function') _worldUnsub();
  };
}

// ── Backward-compat shims ─────────────────────────────────────────────────────
// Phase 3e will delete these once App.tsx mounts <RightSidebar /> directly.
// The shims are fully synchronous (matching original behavior) to preserve
// test compatibility — DOM mutations are applied directly, not via useEffect.

/**
 * Mount `pane` (a DOM element) into the right sidebar slot and open the
 * panel. Idempotent: passing the already-mounted pane does NOT clear or
 * re-append. Passing a different pane swaps the mounted one.
 */
export function showRightSidebar(pane: HTMLElement): void {
  const sidebar = document.getElementById(DOM_IDS.RIGHT_SIDEBAR);
  if (!sidebar) return;

  _ensureResizeHandle(sidebar);
  _applyPersistedWidth(sidebar);

  if (pane && _currentPane(sidebar) !== pane) {
    _clearMountedPane(sidebar);
    sidebar.appendChild(pane);
  }

  sidebar.classList.add('open');
}

/**
 * Hide the sidebar (remove the .open class so it collapses to width 0).
 * Pure DOM mutation; the mounted pane stays in the DOM so it can re-open
 * without rebuilding.
 */
export function hideRightSidebar(): void {
  const sidebar = document.getElementById(DOM_IDS.RIGHT_SIDEBAR);
  if (sidebar) sidebar.classList.remove('open');
}
