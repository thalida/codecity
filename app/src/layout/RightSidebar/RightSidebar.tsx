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
import { useComputed } from '@preact/signals';
import { useEffect } from 'preact/hooks';
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
import { HISTORY_MANIFEST } from '@/state/stores/historyManifest';
import {
  SCRUBBED_MANIFEST,
  loadManifestAt,
  resetScrubbedManifest,
} from '@/state/stores/scrubbedManifest';
import { SETTLED_COMMIT, TIMELINE_BUNDLE } from '@/state/stores/timeline';
import { SOURCE_INFO } from '@/state/stores/source';
import { ROOT_PATH } from '@/constants/manifest';
import { TIMELINE_MODE } from '@/state/stores/timeline';
import { viewCommitInTimeline } from '@/hooks/useTimelineMode';
import { findNodeByPath } from '@/utils/manifest';
import { addExclude } from '@/state/stores/excludes';
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
    authorHues: Object.fromEntries((m?.stats?.authors ?? []).map((a) => [a.name, a.hue])),
    color: handle.world.getTrees()?.colorForSha(commit.sha) ?? undefined,
  };
}

// ── Main component ───────────────────────────────────────────────────

export function RightSidebar() {
  // Pane view-state, derived from the picker selection + manifest. Computeds
  // (read during render) so it's pure render-time reactivity — no effect
  // writing signals, no module-level bridge, no manual world.onChange — they
  // read the MANIFEST signal (the fetch layer's source of truth), so a
  // live-update poll re-derives the enriched panes.
  const activeKind = useComputed<SidebarPaneKind | null>(() => {
    const sel = SCENE_HANDLE.value?.picker.selection.value ?? null;
    // Every selection opens the panel, in Live and Timeline alike — the sidebar is
    // now the only place a selection is shown. In Timeline the panes handle the
    // union-city caveat themselves (file preview reads HEAD with a note; the
    // street pane shows the union folder).
    if (sel?.kind === NodeKind.Commit) return SidebarPaneKind.Commit;
    if (sel?.kind === NodeKind.File) return SidebarPaneKind.File;
    if (sel?.kind === NodeKind.Directory) return SidebarPaneKind.Street;
    return null;
  });
  const fileState = useComputed<FilePreviewPaneState>(() => {
    // History manifest, so the pane follows the scrub: a file absent at this
    // commit reads as deleted here instead of quietly showing HEAD's version.
    const m = HISTORY_MANIFEST.value as Manifest | DirNode | null;
    const sel = SCENE_HANDLE.value?.picker.selection.value ?? null;
    if (sel?.kind !== NodeKind.File) return { file: null };
    const fresh = findNodeByPath(m, sel.file.path);
    // Excludes never reach here: they're filtered out of the timeline union too,
    // so an excluded file has no building to select.
    const present = fresh?.type === NodeKind.File;
    return {
      file: present ? fresh : sel.file,
      rootLabel: SOURCE_INFO.value.label,
      rootPath: (m as Manifest)?.tree?.path ?? ROOT_PATH,
      remoteUrl: (m as Manifest)?.repo?.remote_url ?? null,
      branch: SOURCE_INFO.value.branch,
      isDeleted: TIMELINE_MODE.value && !present,
    };
  });
  const commitState = useComputed<CommitPaneState>(() => {
    void MANIFEST.value; // re-derive on live-update rebuilds
    const inTimeline = TIMELINE_MODE.value; // re-derive so the button label tracks the mode
    const handle = SCENE_HANDLE.value;
    const sel = handle?.picker.selection.value ?? null;
    return handle && sel?.kind === NodeKind.Commit
      ? { ...commitStateFor(handle, sel.commit), inTimeline }
      : { commit: null };
  });
  const streetState = useComputed<StreetPaneState>(() => {
    // Folder rollups are all-time in the union, so in Timeline they come from a
    // real scan of the scrubbed commit; until it lands, the union is the fallback.
    const scrubbed = TIMELINE_MODE.value ? SCRUBBED_MANIFEST.value : null;
    const m = (scrubbed ?? MANIFEST.value) as Manifest | DirNode | null;
    const sel = SCENE_HANDLE.value?.picker.selection.value ?? null;
    if (sel?.kind !== NodeKind.Directory) return { directory: null };
    const fresh = findNodeByPath(m, sel.dir.path);
    return {
      directory: fresh?.type === NodeKind.Directory ? fresh : sel.dir,
      rootLabel: SOURCE_INFO.value.label,
      rootPath: (m as Manifest)?.tree?.path ?? ROOT_PATH,
      remoteUrl: (m as Manifest)?.repo?.remote_url ?? null,
      branch: SOURCE_INFO.value.branch,
      inTimeline: TIMELINE_MODE.value && !SCRUBBED_MANIFEST.value,
    };
  });

  // Reconstructing a commit is expensive, so only fetch it when a street pane is
  // actually open to read it, and only once the scrub has settled.
  const streetDir = useComputed(() => {
    const sel = SCENE_HANDLE.value?.picker.selection.value ?? null;
    return sel?.kind === NodeKind.Directory ? sel.dir.path : null;
  });
  const scrubSha = useComputed(() => {
    if (!TIMELINE_MODE.value) return null;
    return TIMELINE_BUNDLE.value?.commits?.[SETTLED_COMMIT.value]?.sha ?? null;
  });
  const needsScrubbedManifest = streetDir.value !== null;
  const scrubShaValue = scrubSha.value;
  const srcValue = SOURCE_INFO.value.src;
  const branchValue = SOURCE_INFO.value.branch;
  useEffect(() => {
    if (!needsScrubbedManifest || !scrubShaValue || !srcValue) {
      if (!scrubShaValue) resetScrubbedManifest();
      return;
    }
    void loadManifestAt(srcValue, branchValue, scrubShaValue);
  }, [needsScrubbedManifest, scrubShaValue, srcValue, branchValue]);

  // The sidebar is open exactly when something is selected — the selection has no
  // other on-screen indicator, so the two are bound. Closing therefore deselects
  // (below), and re-selecting reopens.
  const isOpen = useComputed(() => activeKind.value !== null);

  const onClose = () => {
    clearSelection();
  };

  const onFileFocus = (file: FileNode) => focusPath(file.path);
  const onCommitFocus = (commit: CommitEntry) => focusCommit(commit.sha);
  const onStreetFocus = (dir: DirNode) => focusPath(dir.path);

  const onExcludeNode = (path: string) => {
    addExclude(path);
    clearSelection(); // the node is about to vanish from the re-fetched manifest
  };

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
        <FilePreviewPane
          state={fileState}
          onClose={onClose}
          onFocus={onFileFocus}
          onExclude={(f) => onExcludeNode(f.path)}
        />
      )}
      {kind === SidebarPaneKind.Commit && (
        <CommitPane
          state={commitState}
          onClose={onClose}
          onFocus={onCommitFocus}
          onViewInTimeline={(commit) => void viewCommitInTimeline(commit.sha)}
        />
      )}
      {kind === SidebarPaneKind.Street && (
        <StreetPane
          state={streetState}
          onClose={onClose}
          onFocus={onStreetFocus}
          onExclude={(d) => onExcludeNode(d.path)}
        />
      )}
    </Sidebar>
  );
}
