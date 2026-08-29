// chrome/CitySidebarRight.tsx — the right panel: its width, its resize handle, and
// which of the three panes the selection calls for. Their view-state is computed
// from the picker and MANIFEST, so a live-update poll re-derives them.

import {
  ROOT_PATH,
  findNodeByPath,
  sourceOf,
  CommitEntry,
  DirNode,
  FileNode,
  Manifest,
  NodeKind,
  PickTarget,
} from '@codecity/city';
import './CitySidebarRight.css';
import { useComputed, useSignal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { useCity } from '@codecity/city/preact';
import type { City } from '@codecity/city';
import { clearSelection, focusPath, focusCommit } from '@/state/stores/city';
import { MANIFEST } from '@/state/stores/manifest';
import {
  PANE_MANIFEST,
  PRESENT_PATHS,
  TIMELINE_MODE,
  scrubbedDirFor,
} from '@/state/stores/timeline';
import { SOURCE_INFO, addExclude } from '@/state/stores/source';
import { viewCommitInTimeline } from '@/hooks/useTimelineMode';
import { FilePreviewPane } from '@/views/CityView/panes/FilePreviewPane/FilePreviewPane';
import type { FilePreviewPaneState } from '@/views/CityView/panes/FilePreviewPane/FilePreviewPane';
import { CommitPane } from '@/views/CityView/panes/CommitPane/CommitPane';
import type { CommitPaneState } from '@/views/CityView/panes/CommitPane/CommitPane';
import { StreetPane } from '@/views/CityView/panes/StreetPane/StreetPane';
import type { StreetPaneState } from '@/views/CityView/panes/StreetPane/StreetPane';
import { Sidebar, SidebarSide } from '@/components/panes/Sidebar/Sidebar';
import { SELECTION_PANE_DISMISSED, dismissSelectionPane } from '@/state/stores/chrome';

/** Which pane the right sidebar is showing, from the current picker selection. */
enum SidebarPaneKind {
  File = 'file',
  Commit = 'commit',
  Street = 'street',
}

// The commit and street panes need things no manifest field holds, so these
// derive them from the scene handle.

function commitStateFor(handle: City, commit: CommitEntry): CommitPaneState {
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

export function CitySidebarRight() {
  // The city this sidebar is about, and its selection as a signal: the panes
  // take signals so a scrub repaints a pane without re-rendering the sidebar.
  const city = useCity();
  const selection = useSignal<PickTarget | null>(null);
  useEffect(() => {
    if (!city) {
      selection.value = null;
      return;
    }
    const sync = () => (selection.value = city.picker.selection);
    sync();
    return city.on('select', sync);
  }, [city]);

  // Computeds read during render: no effect writing signals, no bridge, and a
  // live-update poll re-derives every pane on its own.
  const activeKind = useComputed<SidebarPaneKind | null>(() => {
    const sel = selection.value;
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
    const m = PANE_MANIFEST.value as Manifest | DirNode | null;
    const sel = selection.value;
    if (sel?.kind !== NodeKind.File) return { file: null };
    const fresh = findNodeByPath(m, sel.file.path);
    // Excludes never reach here: they're filtered out of the timeline union too,
    // so an excluded file has no building to select.
    const present = fresh?.type === NodeKind.File;
    return {
      file: present ? fresh : sel.file,
      // The scrub manifest's own source: its paths are what the pane reads by.
      source: sourceOf(m as Manifest | null),
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
    const sel = selection.value;
    return city && sel?.kind === NodeKind.Commit
      ? {
          ...commitStateFor(city, sel.commit),
          source: sourceOf(MANIFEST.value as Manifest | null),
          inTimeline,
        }
      : { commit: null };
  });
  const streetState = useComputed<StreetPaneState>(() => {
    const m = MANIFEST.value as Manifest | DirNode | null;
    const sel = selection.value;
    if (sel?.kind !== NodeKind.Directory) return { directory: null };
    // In Timeline the rollups are re-added at the settled commit from the same
    // per-blob numbers the buildings use, so the pane cannot disagree with them.
    const fresh = TIMELINE_MODE.value
      ? scrubbedDirFor(sel.dir.path)
      : findNodeByPath(m, sel.dir.path);
    return {
      directory: fresh?.type === NodeKind.Directory ? fresh : sel.dir,
      rootLabel: SOURCE_INFO.value.label,
      rootPath: (m as Manifest)?.tree?.path ?? ROOT_PATH,
      remoteUrl: (m as Manifest)?.repo?.remote_url ?? null,
      branch: SOURCE_INFO.value.branch,
      // The same set the sidebar tree filters on, so a road the tree has dropped
      // can't still read as live here.
      isAbsent: TIMELINE_MODE.value && !PRESENT_PATHS.value.has(sel.dir.path),
    };
  });

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
      id="city-sidebar-right"
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
