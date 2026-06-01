// views/shell/RightSidebar.tsx — Right-side panel chrome + pane router.
//
// Owns:
//   - the .open class that drives the open/close transition
//   - the drag-to-resize handle on the inside (left) edge
//   - persisting the chosen width across reloads
//   - choosing which of three panes to mount based on picker selection:
//       file → FilePreviewPane
//       commit → CommitPane
//       directory → StreetPane
//   - feeding live manifest data into the panes (remoteUrl, same-day
//     commit counts, busyness thresholds, tree color)
//
// Full Preact: <aside id="right-sidebar"> is rendered directly. The
// three panes are real Preact components driven by signal state. The
// world.onChange subscription updates the state signals so the panes
// stay fresh through live-update polls.

import { effect, signal, useComputed, useSignal, useSignalEffect } from '@preact/signals';
import type { Signal } from '@preact/signals';
import { useEffect, useRef, useState } from 'preact/hooks';
import { DOM_IDS, STORAGE_KEYS } from '@/constants';
import { NodeKind } from '@/types';
import type { CommitEntry, DirNode, FileNode } from '@/types';
import { SCENE_HANDLE } from '@/state/runtime/scene';
import { FilePreviewPane } from '@/views/panes/FilePreviewPane';
import type { FilePreviewPaneState } from '@/views/panes/FilePreviewPane';
import { CommitPane } from '@/views/panes/CommitPane';
import type { CommitPaneState } from '@/views/panes/CommitPane';
import { StreetPane } from '@/views/panes/StreetPane';
import type { StreetPaneState } from '@/views/panes/StreetPane';

// Persistent width range (in px) for the right sidebar drag handle.
const SIDEBAR_MIN_WIDTH = 280;
const SIDEBAR_MAX_WIDTH_RATIO = 0.7; // fraction of viewport width

type SidebarPaneKind = 'file' | 'commit' | 'street' | null;

// ── Helpers ──────────────────────────────────────────────────────────

function _persistWidth(w: number): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEYS.FILE_SIDEBAR_WIDTH, String(w));
  } catch (_) {
    /* drop */
  }
}

function _readPersistedWidth(): number | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.FILE_SIDEBAR_WIDTH);
    if (raw == null) return null;
    const w = parseFloat(raw);
    if (!Number.isFinite(w)) return null;
    const maxW = Math.floor(window.innerWidth * SIDEBAR_MAX_WIDTH_RATIO);
    return Math.min(maxW, Math.max(SIDEBAR_MIN_WIDTH, w));
  } catch (_) {
    return null;
  }
}

// ── ResizeHandle (left edge of the right sidebar) ────────────────────

function ResizeHandle({ targetRef }: { targetRef: { current: HTMLElement | null } }) {
  // `dragging` is a ref (sync guard for pointermove — no stale-closure race);
  // `isDragging` is state, driving the visual `.dragging` class declaratively.
  const dragging = useRef(false);
  const liveWidth = useRef(0);
  const [isDragging, setIsDragging] = useState(false);

  const onPointerDown = (e: PointerEvent) => {
    dragging.current = true;
    setIsDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!dragging.current || !targetRef.current) return;
    let w = window.innerWidth - e.clientX;
    const maxW = Math.floor(window.innerWidth * SIDEBAR_MAX_WIDTH_RATIO);
    if (w < SIDEBAR_MIN_WIDTH) w = SIDEBAR_MIN_WIDTH;
    if (w > maxW) w = maxW;
    liveWidth.current = w;
    targetRef.current.style.setProperty('--sidebar-width', `${w}px`);
  };
  const onPointerUp = (e: PointerEvent) => {
    if (!dragging.current || !targetRef.current) return;
    dragging.current = false;
    setIsDragging(false);
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    _persistWidth(liveWidth.current || targetRef.current.offsetWidth);
  };

  return (
    <div
      class={`sidebar-resize-handle-right${isDragging ? ' dragging' : ''}`}
      role="separator"
      aria-orientation="vertical"
      title="Drag to resize"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    />
  );
}

// ── Pane state signals (module-level so they survive remounts) ────────

const FILE_STATE: Signal<FilePreviewPaneState> = signal({ file: null });
const COMMIT_STATE: Signal<CommitPaneState> = signal({ commit: null });
const STREET_STATE: Signal<StreetPaneState> = signal({ directory: null });
const ACTIVE_KIND: Signal<SidebarPaneKind> = signal(null);

// One-shot subscription installed at module load. Reads picker
// selection + world.onChange to populate the three pane state signals
// and the ACTIVE_KIND signal.
let _sceneBridgeInstalled = false;
function _installSceneBridge(): void {
  if (_sceneBridgeInstalled) return;
  _sceneBridgeInstalled = true;

  let _selUnsub: (() => void) | null = null;
  let _worldUnsub: (() => void) | null = null;

  function _refreshCommitState(commit: CommitEntry): void {
    const handle = SCENE_HANDLE.peek();
    const m = handle?.world.getManifest();
    COMMIT_STATE.value = {
      commit,
      remoteUrl: m?.repo?.remote_url ?? null,
      sameDayTotal: commit.same_day_total,
      busynessThresholds: m?.busyness ?? { avg: 1, busy: 1 },
      color: handle?.world.getTrees()?.colorForSha(commit.sha) ?? undefined,
    };
  }

  function _refreshStreetState(dir: DirNode): void {
    const handle = SCENE_HANDLE.peek();
    const refreshed = handle?.world.getStreetByDir(dir.path);
    STREET_STATE.value = { directory: refreshed?.dir ?? dir };
  }

  // Read picker.selection on every change → populate pane state.
  function _applySelection(handle: ReturnType<typeof SCENE_HANDLE.peek>): void {
    if (!handle) {
      ACTIVE_KIND.value = null;
      return;
    }
    const sel = handle.picker.selection.peek();
    if (!sel) {
      ACTIVE_KIND.value = null;
      return;
    }
    if (sel.kind === NodeKind.File) {
      FILE_STATE.value = { file: sel.file };
      ACTIVE_KIND.value = 'file';
    } else if (sel.kind === NodeKind.Commit) {
      _refreshCommitState(sel.commit);
      ACTIVE_KIND.value = 'commit';
    } else if (sel.kind === NodeKind.Directory) {
      _refreshStreetState(sel.dir);
      ACTIVE_KIND.value = 'street';
    } else {
      ACTIVE_KIND.value = null;
    }
  }

  // effect() (not .subscribe) — the outer tracks SCENE_HANDLE; the inner
  // tracks picker.selection (both signals). world.onChange is a custom emitter
  // and stays an explicit subscription. The inner effect's disposer is held in
  // _selUnsub and torn down when the handle swaps.
  effect(() => {
    const handle = SCENE_HANDLE.value;
    if (_selUnsub) { _selUnsub(); _selUnsub = null; }
    if (_worldUnsub) { _worldUnsub(); _worldUnsub = null; }
    if (!handle) {
      ACTIVE_KIND.value = null;
      return;
    }
    // Fires immediately (covering the initial selection) + on each change.
    _selUnsub = effect(() => {
      void handle.picker.selection.value;
      _applySelection(handle);
    });
    _worldUnsub = handle.world.onChange(() => {
      const sel = handle.picker.selection.peek();
      // Refresh whatever pane is currently showing so it picks up new
      // manifest data (commit lookup, street dir reference) without
      // changing the active kind.
      if (ACTIVE_KIND.peek() === 'commit' && sel?.kind === NodeKind.Commit) {
        _refreshCommitState(sel.commit);
      } else if (ACTIVE_KIND.peek() === 'street' && sel?.kind === NodeKind.Directory) {
        _refreshStreetState(sel.dir);
      }
    });
  });
}
_installSceneBridge();

// ── Main component ───────────────────────────────────────────────────

export function RightSidebar() {
  const sidebarRef = useRef<HTMLElement>(null);
  // Local override flag — set true when the user clicks a pane's close
  // button, cleared when the picker selection becomes non-null again.
  // Without it, re-selecting the SAME node wouldn't re-open the sidebar
  // (signals dedupe by reference).
  const userClosed = useSignal(false);

  // Clear userClosed any time ACTIVE_KIND becomes null (picker cleared
  // by something other than the close button — keyboard, click on empty
  // space, etc.).
  useSignalEffect(() => {
    if (ACTIVE_KIND.value !== null && userClosed.value) {
      userClosed.value = false;
    }
  });

  // Apply persisted width on mount.
  useEffect(() => {
    const w = _readPersistedWidth();
    if (w != null && sidebarRef.current) {
      sidebarRef.current.style.setProperty('--sidebar-width', `${w}px`);
    }
  }, []);

  // Effective open state: true when there's an active pane AND the user
  // hasn't closed it. The .open class drives the CSS transition.
  const isOpen = useComputed(() => ACTIVE_KIND.value !== null && !userClosed.value);

  const onClose = () => {
    userClosed.value = true;
    SCENE_HANDLE.peek()?.picker.clearSelection();
  };

  const onFileFocus = (file: FileNode) => {
    const handle = SCENE_HANDLE.peek();
    handle?.rig.focusSelection(handle.picker.targetForPath(file.path));
  };

  const onCommitFocus = (commit: CommitEntry) => {
    SCENE_HANDLE.peek()?.rig.focusTree(commit.sha);
  };

  const onStreetFocus = (dir: DirNode) => {
    const handle = SCENE_HANDLE.peek();
    handle?.rig.focusSelection(handle.picker.targetForPath(dir.path));
  };

  const kind = ACTIVE_KIND.value;
  const open = isOpen.value;

  return (
    <aside
      ref={sidebarRef}
      id={DOM_IDS.RIGHT_SIDEBAR}
      class={open ? 'open' : ''}
    >
      {kind === 'file' && (
        <FilePreviewPane state={FILE_STATE} onClose={onClose} onFocus={onFileFocus} />
      )}
      {kind === 'commit' && (
        <CommitPane state={COMMIT_STATE} onClose={onClose} onFocus={onCommitFocus} />
      )}
      {kind === 'street' && (
        <StreetPane state={STREET_STATE} onClose={onClose} onFocus={onStreetFocus} />
      )}
      <ResizeHandle targetRef={sidebarRef} />
    </aside>
  );
}

