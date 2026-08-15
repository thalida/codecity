// layout/RightSidebar.tsx — the right panel: its width, its resize handle, and
// which of the three panes the selection calls for. Their view-state is computed
// from the picker and MANIFEST, so a live-update poll re-derives them.

import './RightSidebar.css';
import { useComputed } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { NodeKind } from '@/types';
import type { CommitEntry, DirNode, FileNode, Manifest } from '@/types';
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
import { PRESENT_PATHS } from '@/state/stores/presentPaths';
import { SETTLED_COMMIT, TIMELINE_BUNDLE } from '@/state/stores/timeline';
import { SOURCE_INFO } from '@/state/stores/source';
import { ROOT_PATH } from '@/constants/manifest';
import { TIMELINE_MODE } from '@/state/stores/timeline';
import { viewCommitInTimeline } from '@/hooks/useTimelineMode';
import { findNodeByPath } from '@/utils/manifest';
import { addExclude } from '@/state/stores/excludes';
import { FilePreviewPane } from '@/panes/FilePreviewPane/FilePreviewPane';
import type { FilePreviewPaneState } from '@/panes/FilePreviewPane/FilePreviewPane';
import { CommitPane } from '@/panes/CommitPane/CommitPane';
import type { CommitPaneState } from '@/panes/CommitPane/CommitPane';
import { StreetPane } from '@/panes/StreetPane/StreetPane';
import type { StreetPaneState } from '@/panes/StreetPane/StreetPane';
import { Sidebar, SidebarSide } from '@/components/Sidebar/Sidebar';
import { SELECTION_PANE_DISMISSED, dismissSelectionPane } from '@/state/stores/ui';

/** Which pane the right sidebar is showing, from the current picker selection. */
enum SidebarPaneKind {
  File = 'file',
  Commit = 'commit',
  Street = 'street',
}

// The commit and street panes need things no manifest field holds, so these
// derive them from the scene handle.

function commitStateFor(handle: SceneHandle, commit: CommitEntry): CommitPaneState {
  // peek: the calling computed already re-derives on MANIFEST, so a tracked
  // read here would only double it.
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
  // Computeds read during render: no effect writing signals, no bridge, and a
  // live-update poll re-derives every pane on its own.
  const activeKind = useComputed<SidebarPaneKind | null>(() => {
    const sel = SCENE_HANDLE.value?.picker.selection.value ?? null;
    // Every selection opens the panel: the sidebar is the only place one is
    // shown. The panes handle the union-city caveat themselves.
    if (sel?.kind === NodeKind.Commit) return SidebarPaneKind.Commit;
    if (sel?.kind === NodeKind.File) return SidebarPaneKind.File;
    if (sel?.kind === NodeKind.Directory) return SidebarPaneKind.Street;
    return null;
  });
  const fileState = useComputed<FilePreviewPaneState>(() => {
    // History manifest, so the pane follows the scrub: a file absent at this
    // commit says so here instead of quietly showing HEAD's version.
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
      isAbsent: TIMELINE_MODE.value && !present,
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
      // The same set the sidebar tree filters on, so a road the tree has dropped
      // can't still read as live here. Its rollups are the union's either way.
      isAbsent: TIMELINE_MODE.value && !PRESENT_PATHS.value.has(sel.dir.path),
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

  // Two facts, not one: closing used to deselect, throwing away the outline
  // because you wanted the details out of the way.
  const isOpen = useComputed(() => activeKind.value !== null && !SELECTION_PANE_DISMISSED.value);

  const dismiss = dismissSelectionPane;

  // Clearing the drawers out of the way on a phone is the focus command's job
  // (stores/scene), so every focus button in the app behaves the same.
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
      open={open}
    >
      {kind === SidebarPaneKind.File && (
        <FilePreviewPane
          state={fileState}
          onClose={dismiss}
          onFocus={onFileFocus}
          onExclude={(f) => onExcludeNode(f.path)}
        />
      )}
      {kind === SidebarPaneKind.Commit && (
        <CommitPane
          state={commitState}
          onClose={dismiss}
          onFocus={onCommitFocus}
          onViewInTimeline={(commit) => void viewCommitInTimeline(commit.sha)}
        />
      )}
      {kind === SidebarPaneKind.Street && (
        <StreetPane
          state={streetState}
          onClose={dismiss}
          onFocus={onStreetFocus}
          onExclude={(d) => onExcludeNode(d.path)}
        />
      )}
    </Sidebar>
  );
}
