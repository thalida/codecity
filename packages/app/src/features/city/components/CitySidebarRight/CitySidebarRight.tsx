// features/city/components/CitySidebarRight/CitySidebarRight.tsx — the right panel: its width, its resize handle, and
// which of the three panes the selection calls for. Their view-state is computed
// from the picker and MANIFEST, so a live-update poll re-derives them.

import {
  ROOT_PATH,
  findNodeByPath,
  sourceOf,
  type CommitEntry,
  type DirNode,
  type FileNode,
  type Manifest,
  NodeKind,
  type City,
} from '@codecity/city';
import { useSourceInfo } from '@/features/city/hooks/useSourceInfo';
import './CitySidebarRight.css';
import {
  useCity,
  useCityManifest,
  useCitySelection,
  useCityTimeline,
  useScrub,
} from '@codecity/city/preact';
import { useCityCommands } from '@/features/city/state/commands';
import { addExclude } from '@/state/excludes';
import { setUrlTimelineMode } from '@/router/cityUrl';
import {
  FilePreviewPane,
  type FilePreviewPaneState,
} from '@/features/city/components/FilePreviewPane/FilePreviewPane';
import { CommitPane, type CommitPaneState } from '@/features/city/components/CommitPane/CommitPane';
import { StreetPane, type StreetPaneState } from '@/features/city/components/StreetPane/StreetPane';
import { Sidebar, SidebarSide } from '@/components/Sidebar/Sidebar';
import { useCityChrome } from '@/features/city/state/sidebar';

/** Which pane the right sidebar is showing, from the current picker selection. */
enum SidebarPaneKind {
  File = 'file',
  Commit = 'commit',
  Street = 'street',
}

// The commit pane needs things no manifest field holds — the tree's own colour
// for the sha — so it is given the city as well as what that city published.

function commitStateFor(handle: City, m: Manifest | null, commit: CommitEntry): CommitPaneState {
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
  const city = useCity();
  const { clearSelection, focusPath, focusCommit } = useCityCommands();
  const manifest = useCityManifest();
  const inTimeline = useCityTimeline().mode;
  const scrub = useScrub();
  const sourceInfo = useSourceInfo();
  const chrome = useCityChrome();
  const selection = useCitySelection();

  // Computeds read during render: no effect writing signals, no bridge, and a
  // live-update poll re-derives every pane on its own.
  const activeKind = ((): SidebarPaneKind | null => {
    const sel = selection;
    // Every selection opens the panel: the sidebar is the only place one is
    // shown. The panes handle the union-city caveat themselves.
    if (sel?.kind === NodeKind.Commit) return SidebarPaneKind.Commit;
    if (sel?.kind === NodeKind.File) return SidebarPaneKind.File;
    if (sel?.kind === NodeKind.Directory) return SidebarPaneKind.Street;
    return null;
  })();
  const fileState = ((): FilePreviewPaneState => {
    // History manifest, so the pane follows the scrub: a file absent at this
    // commit says so here instead of quietly showing HEAD's version.
    const m = scrub?.manifest as Manifest | DirNode | null;
    const sel = selection;
    if (sel?.kind !== NodeKind.File) return { file: null };
    const fresh = findNodeByPath(m, sel.file.path);
    // Excludes never reach here: they're filtered out of the timeline union too,
    // so an excluded file has no building to select.
    const present = fresh?.type === NodeKind.File;
    return {
      file: present ? fresh : sel.file,
      // The scrub manifest's own source: its paths are what the pane reads by.
      source: sourceOf(m as Manifest | null),
      rootLabel: sourceInfo.label,
      rootPath: (m as Manifest)?.tree?.path ?? ROOT_PATH,
      remoteUrl: (m as Manifest)?.repo?.remote_url ?? null,
      branch: sourceInfo.branch,
      isAbsent: inTimeline && !present,
    };
  })();
  const commitState = ((): CommitPaneState => {
    void manifest; // re-derive on live-update rebuilds
    const sel = selection;
    return city && sel?.kind === NodeKind.Commit
      ? {
          ...commitStateFor(city, manifest, sel.commit),
          source: sourceOf(manifest),
          inTimeline,
        }
      : { commit: null };
  })();
  const streetState = ((): StreetPaneState => {
    const m = manifest as Manifest | DirNode | null;
    const sel = selection;
    if (sel?.kind !== NodeKind.Directory) return { directory: null };
    // In Timeline the rollups are re-added at the settled commit from the same
    // per-blob numbers the buildings use, so the pane cannot disagree with them.
    const fresh = inTimeline ? scrub?.dirAt(sel.dir.path) : findNodeByPath(m, sel.dir.path);
    return {
      directory: fresh?.type === NodeKind.Directory ? fresh : sel.dir,
      rootLabel: sourceInfo.label,
      rootPath: (m as Manifest)?.tree?.path ?? ROOT_PATH,
      remoteUrl: (m as Manifest)?.repo?.remote_url ?? null,
      branch: sourceInfo.branch,
      // The same set the sidebar tree filters on, so a road the tree has dropped
      // can't still read as live here.
      isAbsent: inTimeline && !scrub?.present.has(sel.dir.path),
    };
  })();

  // Two facts, not one: closing used to deselect, throwing away the outline
  // because you wanted the details out of the way.
  const isOpen = activeKind !== null && !chrome.detailsDismissed.value;

  const dismiss = chrome.dismissDetails;

  // Clearing the drawers out of the way on a phone is the focus command's job
  // (stores/scene), so every focus button in the app behaves the same.
  const onFileFocus = (file: FileNode) => focusPath(file.path);
  const onCommitFocus = (commit: CommitEntry) => focusCommit(commit.sha);
  const onStreetFocus = (dir: DirNode) => focusPath(dir.path);

  const onExcludeNode = (path: string) => {
    addExclude(path);
    clearSelection(); // the node is about to vanish from the re-fetched manifest
  };

  const kind = activeKind;
  const open = isOpen;

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
          onViewInTimeline={(commit) => setUrlTimelineMode(true, commit.sha)}
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
