// layout/RightSidebar.tsx — Right-side panel chrome + pane router.
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
import { DOM_IDS, PERSISTED_KEYS } from '@/constants';
import { NodeKind } from '@/types';
import type { CommitEntry, DirNode, FileNode } from '@/types';
import { persistedSignal } from '@/state/persist';
import { SCENE_HANDLE } from '@/state/stores/scene';
import { FilePreviewPane } from '@/views/FilePreviewPane';
import type { FilePreviewPaneState } from '@/views/FilePreviewPane';
import { CommitPane } from '@/views/CommitPane';
import type { CommitPaneState } from '@/views/CommitPane';
import { StreetPane } from '@/views/StreetPane';
import type { StreetPaneState } from '@/views/StreetPane';
import { Sidebar, SidebarSide } from '@/components/Sidebar';

// Persisted drag-handle width via persistedSignal (the store abstraction) —
// null until the user first drags (null ⇒ fall back to the CSS default width).
// The width range is enforced by #right-sidebar.open's CSS min-width/max-width.
const RIGHT_SIDEBAR_WIDTH = persistedSignal<number | null>(PERSISTED_KEYS.RIGHT_SIDEBAR_WIDTH, null);

/** Which pane the right sidebar is showing, from the current picker selection. */
enum SidebarPaneKind {
  File = 'file',
  Commit = 'commit',
  Street = 'street',
}

// ── Pane state signals (module-level so they survive remounts) ────────

const FILE_STATE: Signal<FilePreviewPaneState> = signal({ file: null });
const COMMIT_STATE: Signal<CommitPaneState> = signal({ commit: null });
const STREET_STATE: Signal<StreetPaneState> = signal({ directory: null });
const ACTIVE_KIND: Signal<SidebarPaneKind | null> = signal(null);

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
      ACTIVE_KIND.value = SidebarPaneKind.File;
    } else if (sel.kind === NodeKind.Commit) {
      _refreshCommitState(sel.commit);
      ACTIVE_KIND.value = SidebarPaneKind.Commit;
    } else if (sel.kind === NodeKind.Directory) {
      _refreshStreetState(sel.dir);
      ACTIVE_KIND.value = SidebarPaneKind.Street;
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
      if (ACTIVE_KIND.peek() === SidebarPaneKind.Commit && sel?.kind === NodeKind.Commit) {
        _refreshCommitState(sel.commit);
      } else if (ACTIVE_KIND.peek() === SidebarPaneKind.Street && sel?.kind === NodeKind.Directory) {
        _refreshStreetState(sel.dir);
      }
    });
  });
}
_installSceneBridge();

// ── Main component ───────────────────────────────────────────────────

export function RightSidebar() {
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

  // Effective open state: true when there's an active pane AND the user
  // hasn't closed it. The .open class drives the CSS transition.
  const isOpen = useComputed(() => ACTIVE_KIND.value !== null && !userClosed.value);

  const onClose = () => {
    userClosed.value = true;
    SCENE_HANDLE.peek()?.picker.clearSelection();
  };

  const onFileFocus = (file: FileNode) => {
    SCENE_HANDLE.peek()?.focusByPath(file.path);
  };

  const onCommitFocus = (commit: CommitEntry) => {
    SCENE_HANDLE.peek()?.rig.focusTree(commit.sha);
  };

  const onStreetFocus = (dir: DirNode) => {
    SCENE_HANDLE.peek()?.focusByPath(dir.path);
  };

  const kind = ACTIVE_KIND.value;
  const open = isOpen.value;

  return (
    <Sidebar
      id={DOM_IDS.RIGHT_SIDEBAR}
      side={SidebarSide.Right}
      class={open ? 'open' : ''}
      widthSignal={RIGHT_SIDEBAR_WIDTH}
    >
      {kind === SidebarPaneKind.File && (
        <FilePreviewPane state={FILE_STATE} onClose={onClose} onFocus={onFileFocus} />
      )}
      {kind === SidebarPaneKind.Commit && (
        <CommitPane state={COMMIT_STATE} onClose={onClose} onFocus={onCommitFocus} />
      )}
      {kind === SidebarPaneKind.Street && (
        <StreetPane state={STREET_STATE} onClose={onClose} onFocus={onStreetFocus} />
      )}
    </Sidebar>
  );
}

