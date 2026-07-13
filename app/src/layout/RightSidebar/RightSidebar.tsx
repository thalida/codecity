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
// pane view-state is computed from the picker selection + the MANIFEST
// signal (the fetch layer's source of truth), so the panes re-derive
// automatically when a live-update poll publishes a fresh manifest.

import './RightSidebar.css';
import { useComputed, useSignal, useSignalEffect } from '@preact/signals';
import { PERSISTED_KEYS } from '@/constants/storage';
import { NodeKind } from '@/types';
import type { CommitEntry, DirNode, FileNode, Manifest } from '@/types';
import { persistedSignal } from '@/state/persist';
import {
  SCENE_HANDLE,
  type SceneHandle,
  clearSelection,
  focusPath,
  focusCommit,
} from '@/state/stores/scene';
import { MANIFEST } from '@/state/stores/manifest';
import { FilePreviewPane } from '@/views/FilePreviewPane/FilePreviewPane';
import type { FilePreviewPaneState } from '@/views/FilePreviewPane/FilePreviewPane';
import { CommitPane } from '@/views/CommitPane/CommitPane';
import type { CommitPaneState } from '@/views/CommitPane/CommitPane';
import { StreetPane } from '@/views/StreetPane/StreetPane';
import type { StreetPaneState } from '@/views/StreetPane/StreetPane';
import { Sidebar, SidebarSide } from '@/components/Sidebar/Sidebar';

// Persisted drag-handle width via persistedSignal (the store abstraction) —
// null until the user first drags (null ⇒ fall back to the CSS default width).
// The width range is enforced by #right-sidebar.open's CSS min-width/max-width.
const RIGHT_SIDEBAR_WIDTH = persistedSignal<number | null>(
  PERSISTED_KEYS.RIGHT_SIDEBAR_WIDTH,
  null
);

/** Which pane the right sidebar is showing, from the current picker selection. */
enum SidebarPaneKind {
  File = 'file',
  Commit = 'commit',
  Street = 'street',
}

// ── Pane view-state derivation ───────────────────────────────────────
// The commit/street panes need bits that aren't plain manifest fields (tree
// color, busyness thresholds, remote URL, the live street lookup), so they're
// computed from the scene handle. Pure helpers — the component's effect calls
// them and writes the result into component-local signals.

function commitStateFor(handle: SceneHandle, commit: CommitEntry): CommitPaneState {
  // Repo-level fields off the canonical MANIFEST signal. peek() since the
  // calling computed already re-derives via its explicit `void MANIFEST.value`;
  // a reactive read here would just double it. getTrees() stays on the handle —
  // it's genuine scene state (the live tree renderer's per-sha color).
  const m = MANIFEST.peek() as Manifest;
  return {
    commit,
    remoteUrl: m?.repo?.remote_url ?? null,
    sameDayTotal: commit.same_day_total,
    busynessThresholds: m?.busyness ?? { avg: 1, busy: 1 },
    color: handle.world.getTrees()?.colorForSha(commit.sha) ?? undefined,
  };
}

// ── Main component ───────────────────────────────────────────────────

export function RightSidebar() {
  // Local override flag — set true when the user clicks a pane's close
  // button, cleared when the picker selection becomes non-null again.
  // Without it, re-selecting the SAME node wouldn't re-open the sidebar
  // (signals dedupe by reference).
  const userClosed = useSignal(false);

  // Pane view-state, derived from the picker selection + manifest. Computeds
  // (read during render) so it's pure render-time reactivity — no effect
  // writing signals, no module-level bridge, no manual world.onChange — they
  // read the MANIFEST signal (the fetch layer's source of truth), so a
  // live-update poll re-derives the enriched panes.
  const activeKind = useComputed<SidebarPaneKind | null>(() => {
    const sel = SCENE_HANDLE.value?.picker.selection.value ?? null;
    if (sel?.kind === NodeKind.File) return SidebarPaneKind.File;
    if (sel?.kind === NodeKind.Commit) return SidebarPaneKind.Commit;
    if (sel?.kind === NodeKind.Directory) return SidebarPaneKind.Street;
    return null;
  });
  const fileState = useComputed<FilePreviewPaneState>(() => {
    const sel = SCENE_HANDLE.value?.picker.selection.value ?? null;
    return { file: sel?.kind === NodeKind.File ? sel.file : null };
  });
  const commitState = useComputed<CommitPaneState>(() => {
    void MANIFEST.value; // re-derive on live-update rebuilds
    const handle = SCENE_HANDLE.value;
    const sel = handle?.picker.selection.value ?? null;
    return handle && sel?.kind === NodeKind.Commit
      ? commitStateFor(handle, sel.commit)
      : { commit: null };
  });
  const streetState = useComputed<StreetPaneState>(() => {
    // The picker's Directory selection already carries the live street's dir
    // (re-resolved on rebuild), so the pane just reflects it — no world lookup.
    const sel = SCENE_HANDLE.value?.picker.selection.value ?? null;
    return sel?.kind === NodeKind.Directory ? { directory: sel.dir } : { directory: null };
  });

  // Re-open after a manual close once a fresh selection arrives.
  useSignalEffect(() => {
    if (activeKind.value !== null && userClosed.value) {
      userClosed.value = false;
    }
  });

  // Effective open state: true when there's an active pane AND the user
  // hasn't closed it. The .open class drives the CSS transition.
  const isOpen = useComputed(() => activeKind.value !== null && !userClosed.value);

  const onClose = () => {
    userClosed.value = true;
    clearSelection();
  };

  const onFileFocus = (file: FileNode) => focusPath(file.path);
  const onCommitFocus = (commit: CommitEntry) => focusCommit(commit.sha);
  const onStreetFocus = (dir: DirNode) => focusPath(dir.path);

  const kind = activeKind.value;
  const open = isOpen.value;

  return (
    <Sidebar
      id="right-sidebar"
      side={SidebarSide.Right}
      ariaLabel="Selection details"
      class={open ? 'open' : ''}
      widthSignal={RIGHT_SIDEBAR_WIDTH}
    >
      {kind === SidebarPaneKind.File && (
        <FilePreviewPane state={fileState} onClose={onClose} onFocus={onFileFocus} />
      )}
      {kind === SidebarPaneKind.Commit && (
        <CommitPane state={commitState} onClose={onClose} onFocus={onCommitFocus} />
      )}
      {kind === SidebarPaneKind.Street && (
        <StreetPane state={streetState} onClose={onClose} onFocus={onStreetFocus} />
      )}
    </Sidebar>
  );
}
