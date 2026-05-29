// coordinator.ts — top-level orchestrator. The only module that imports
// from both views/ and scene/. Owns the lifecycle of appHeader,
// appFooter, leftSidebar, and the right-sidebar's mounted file-preview
// pane, plus the picker → views synchronization.
//
// Subscribes to picker.selection / picker.hover and updates breadcrumb,
// status strip, file-preview pane, and the tree pane's highlight. Also
// wires tree-row clicks / hovers / focus dispatches back into picker +
// cameraRig so tree-driven actions take the same code path canvas-driven
// actions do.
//
// Public:
//   const coord = createCoordinator({
//     world, picker, rig,
//     applyTheme,
//   });
//   coord.dispose();

import { initAppHeader } from './views/shell/appHeader.js';
import { initAppFooter } from './views/shell/appFooter.js';
import { showLeftSidebar } from './views/shell/leftSidebar.js';
import { showRightSidebar, hideRightSidebar } from './views/shell/rightSidebar.js';
import { buildFilePreviewPane, humanLanguageFor } from './views/panes/filePreviewPane.js';
import { buildCommitPane } from './views/panes/commitPane.js';
import { buildStreetPane } from './views/panes/streetPane.js';
import { sameDayCommitCount } from './views/widgets/commitMetrics.js';
import { labelFromManifest } from './views/widgets/displayLabel.js';
import { LIVE_UPDATES } from './config/index.js';
import { REBUILD_STATUS, LAST_REBUILD_ERROR, LAST_UPDATED_AT } from './store/liveStatus.js';
import { DateSource, NodeKind } from './types';
import type { DirNode, FileNode, PickTarget, TreeNode } from './types';
import type { createWorld } from './scene/world.js';
import type { createPicker } from './scene/system/picker.js';
import type { createCameraRig } from './scene/system/cameraRig.js';

interface CoordinatorOpts {
  world: ReturnType<typeof createWorld>;
  picker: ReturnType<typeof createPicker>;
  rig: ReturnType<typeof createCameraRig>;
  /** Reset for the camera. Forwarded to the header gem button so it stays
   *  consistent with the R key and the in-scene gem click. */
  resetView: () => void;
  applyTheme: () => void;
}

export function createCoordinator({ world, picker, rig, resetView, applyTheme }: CoordinatorOpts) {
  // Right-sidebar pane choice. Selection drives which pane is mounted:
  //   File → filePreview
  //   Commit → commitPane
  //   anything else → sidebar closed
  type SidebarPane = 'file' | 'commit' | 'street' | null;
  let sidebarPane: SidebarPane = null;

  const filePreview = buildFilePreviewPane({
    onClose() {
      sidebarPane = null;
      _renderSidebar();
    },
    onFocus(file) {
      const b = world.getBuildingByPath(file.path);
      if (b) rig.focusBuilding(b.mesh, b.building);
    },
  });

  const commitPane = buildCommitPane({
    onClose() {
      sidebarPane = null;
      _renderSidebar();
    },
    onFocus(c) {
      rig.focusTree(c.sha);
    },
  });

  const streetPane = buildStreetPane({
    onClose() {
      sidebarPane = null;
      _renderSidebar();
    },
    onFocus(d) {
      const st = world.getStreetByDir(d.path);
      if (st) rig.focusStreet(st, null);
    },
  });

  function _renderSidebar(): void {
    if (sidebarPane === null) {
      hideRightSidebar();
      return;
    }
    const sel = picker.selection.get();
    if (sidebarPane === 'file') {
      showRightSidebar(filePreview.pane);
      if (sel && sel.kind === NodeKind.File) filePreview.api.setFile(sel.file);
      else filePreview.api.setFile(null);
      return;
    }
    if (sidebarPane === 'commit') {
      showRightSidebar(commitPane.pane);
      const m = world.getManifest();
      const remote = m?.repo?.remote_url ?? null;
      if (sel && sel.kind === NodeKind.Commit) {
        const commits = m?.commits ?? [];
        const sameDayTotal = sameDayCommitCount(sel.commit, commits);
        const color = world.getTrees()?.colorForSha(sel.commit.sha) ?? undefined;
        commitPane.api.setCommit(sel.commit, { remoteUrl: remote, sameDayTotal, color });
      } else {
        commitPane.api.setCommit(null);
      }
      return;
    }
    if (sidebarPane === 'street') {
      showRightSidebar(streetPane.pane);
      // Defer the heavy DOM mutation past the current event-loop task —
      // setDirectory walks the descendant subtree and builds rows for every
      // extension, which is enough work that running it synchronously
      // during the pointerup that triggered this render confused canvas
      // pointer state and broke subsequent hover/click. setTimeout(0)
      // yields the task so the pointer event lifecycle completes first.
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

  // ── App header (refresh / project chip / breadcrumb) ──────────────
  const rootNode: DirNode | null = world.getRoot();
  const _initManifest = world.getManifest();
  // Derive the friendly label for the header breadcrumb and document title.
  // manifest.tree.name is already set to the friendly value by main.ts
  // (_applyDisplayLabel) before applyManifest is called, so no mutation needed here.
  const _rootLabel = labelFromManifest(_initManifest) ?? rootNode?.name ?? '';
  document.title = _rootLabel ? `${_rootLabel} — codecity` : 'codecity';
  // Read initial branch + source URL from the current page URL so the header
  // can show the branch pill and repo link on first paint.
  const _qp = new URLSearchParams(window.location.search);
  const _initSrc = _qp.get('src') ?? undefined;
  const _initBranch = _qp.get('branch') ?? undefined;
  const _initIsGitUrl = _initSrc ? /:\/\//.test(_initSrc) || /^[^@]+@[^:]+:/.test(_initSrc) : false;

  const appHeader = initAppHeader({
    rootLabel: _rootLabel,
    rootPath: rootNode?.path || '',
    onSegmentClick(path: string) {
      picker.selectByPath(path);
    },
    onSwitchSource() {
      const fn = (window as Window & { __openSourcePicker?: () => void }).__openSourcePicker;
      fn?.();
    },
    onResetView: resetView,
    // Focus button next to the selected path — mirrors pressing F on the
    // canvas. Looks at the current picker selection and dispatches the
    // matching camera-rig call.
    onFocus() {
      const sel = picker.selection.get();
      if (!sel) return;
      if (sel.kind === NodeKind.File) rig.focusBuilding(sel.mesh, sel.data);
      else if (sel.kind === NodeKind.Directory) rig.focusStreet(sel.street, null);
      else if (sel.kind === NodeKind.Commit) rig.focusTree(sel.commit.sha);
    },
    branch: _initBranch,
    sourceUrl: _initIsGitUrl ? _initSrc : undefined,
  });
  appHeader.setSelection(null);

  // ── App footer ─────────────────────────────────────────────────────
  const appFooter = initAppFooter({});
  const initialManifest = world.getManifest();
  // Empty by default — selection metadata only appears once the user
  // hovers or picks something. The previous fallback that showed root
  // directory totals was confusing because it looked like a real "current"
  // selection.
  appFooter.setSelection(null);

  // Seed the "last updated" stamp from the initial manifest apply that
  // already happened in startRenderLoop — world.onChange won't fire
  // for that, so without this the footer would render "—" until the
  // first poll lands a fresh manifest.
  if (initialManifest) LAST_UPDATED_AT.set(Date.now());

  function _refreshStatus(): void {
    appFooter.setStatus({
      liveEnabled: LIVE_UPDATES.get().ENABLED,
      rebuildStatus: REBUILD_STATUS.get(),
      lastUpdatedAt: LAST_UPDATED_AT.get(),
      errorMessage: LAST_REBUILD_ERROR.get(),
    });
  }
  _refreshStatus();
  const _liveCfgUnsub = LIVE_UPDATES.subscribe(_refreshStatus);
  const _statusUnsub = REBUILD_STATUS.subscribe(_refreshStatus);
  // _errorUnsub catches updated error messages even when REBUILD_STATUS
  // is already 'error' (e.g. two failing polls in a row with different
  // messages) — the tooltip needs to refresh on every message change.
  const _errorUnsub = LAST_REBUILD_ERROR.subscribe(_refreshStatus);
  const _stampUnsub = LAST_UPDATED_AT.subscribe(_refreshStatus);
  // Re-render every second so the relative timestamp ("5s ago" → "6s
  // ago") advances smoothly while idle.
  const _tickHandle = window.setInterval(_refreshStatus, 1000);

  _renderSidebar(); // initial paint

  // ── Tree pane (left sidebar) ───────────────────────────────────────
  function _onTreeSelect(node: TreeNode): void {
    if (!node || !node.path) return;
    picker.selectByPath(node.path);
  }

  function _onTreeFocus(node: TreeNode): void {
    if (!node || !node.path) return;
    if (node.type === NodeKind.File) {
      const b = world.getBuildingByPath(node.path);
      if (b) rig.focusBuilding(b.mesh, b.building);
    } else if (node.type === NodeKind.Directory) {
      const st = world.getStreetByDir(node.path);
      if (st) rig.focusStreet(st, null);
    }
  }

  function _onTreeHover(node: TreeNode): void {
    if (!node || !node.path) return;
    if (node.type === NodeKind.File) {
      const b = world.getBuildingByPath(node.path);
      if (!b) return;
      picker.setHover({
        kind: NodeKind.File,
        mesh: b.mesh,
        data: b.building,
        file: b.building.file,
      });
    } else if (node.type === NodeKind.Directory) {
      const sw = world.getSidewalkByDir(node.path);
      const st = world.getStreetByDir(node.path);
      if (!sw || !st || !st.dir) return;
      picker.setHover({
        kind: NodeKind.Directory,
        sidewalk: sw,
        street: st,
        dir: st.dir,
      });
    }
  }

  function _onTreeHoverEnd(): void {
    picker.setHover(null);
  }

  const manifest = world.getManifest();
  // Boot order guarantees a manifest is in place by the time the
  // coordinator runs (createWorld → applyManifest → createCoordinator),
  // but we guard explicitly so a future caller refactoring the boot
  // order surfaces a real error instead of a buried `manifest!` panic.
  if (!manifest) {
    throw new Error(
      'coordinator: world has no manifest — applyManifest must run before createCoordinator'
    );
  }
  const leftSidebarApi = showLeftSidebar(manifest, {
    onResetView() {
      rig.reset();
    },
    applyTheme: applyTheme || function () {},
    onTreeSelect: _onTreeSelect,
    onTreeFocus: _onTreeFocus,
    onTreeHover: _onTreeHover,
    onTreeHoverEnd: _onTreeHoverEnd,
    onSearchSelect(path: string) {
      picker.selectByPath(path);
    },
    onSearchFocus(path: string) {
      const b = world.getBuildingByPath(path);
      if (b) rig.focusBuilding(b.mesh, b.building);
    },
    onRunCollisionCheck: () => world.runCollisionCheck(),
    onRunStemDiagnostic: () => world.runStemPlacementDiagnostic(),
  });

  function _pathOf(target: PickTarget | null): string | null {
    if (!target) return null;
    if (target.kind === NodeKind.File) return target.file?.path ?? null;
    if (target.kind === NodeKind.Directory) return target.dir?.path ?? null;
    return null;
  }

  // ── Footer selection helper ────────────────────────────────────────
  // Converts a PickTarget (or null) to the FooterSelectionInfo shape and
  // pushes it into appFooter.  When the target is null or a non-file /
  // non-directory kind (e.g. Gem), falls back to the repo root directory
  // stats so the footer never shows a blank state.
  function _setFooterForTarget(target: PickTarget | null): void {
    if (target && target.kind === NodeKind.File) {
      const f: FileNode = target.file;
      const hasGit = !!(f.git && (f.git.created || f.git.modified));
      appFooter.setSelection({
        kind: NodeKind.File,
        extension: f.extension || '',
        language: humanLanguageFor(f),
        lines: f.lines,
        size: f.size || 0,
        modified: (f.git && f.git.modified) || f.modified || null,
        created: (f.git && f.git.created) || f.created || null,
        dateSource: hasGit ? DateSource.Git : DateSource.Filesystem,
      });
    } else if (target && target.kind === NodeKind.Directory) {
      const d: DirNode = target.dir;
      appFooter.setSelection({
        kind: NodeKind.Directory,
        directFiles: d.children_file_count ?? 0,
        totalFiles: d.descendants_file_count ?? 0,
        directDirs: d.children_dir_count ?? 0,
        totalDirs: d.descendants_dir_count ?? 0,
        size: d.descendants_size ?? 0,
      });
    } else {
      // No selection / no hover — empty the footer right section. The
      // previous fallback to root directory totals read as a misleading
      // "current selection" when nothing was actually picked.
      appFooter.setSelection(null);
    }
  }

  // Footer follows hover when present, falls back to selection when
  // hover ends.  Both subscriptions call this shared updater so the
  // displayed info is always consistent with whichever atom changed last.
  function _updateFooterFromState(): void {
    const hov = picker.hover.get();
    const sel = picker.selection.get();
    _setFooterForTarget(hov ?? sel);
  }

  // ── picker → sidebar reactions ─────────────────────────────────────
  const _selUnsub = picker.selection.subscribe((sel: PickTarget | null) => {
    // Tree highlight follows selection.
    if (leftSidebarApi.setSelectedTreePath) {
      leftSidebarApi.setSelectedTreePath(_pathOf(sel));
    }

    // Breadcrumb tail
    if (sel?.kind === NodeKind.Commit) {
      appHeader.setSelection({
        kind: 'commit',
        sha: sel.commit.sha,
        author: sel.commit.author,
      });
    } else if (sel?.kind === NodeKind.File) {
      const node = sel.file;
      appHeader.setSelection({
        kind: 'file',
        path: node.path || node.fullPath || node.name || '',
        fullPath: node.fullPath || '',
        extension: node.extension || '',
        isDir: false,
      });
    } else if (sel?.kind === NodeKind.Directory) {
      const node = sel.dir;
      appHeader.setSelection({
        kind: 'dir',
        path: node.path || node.fullPath || node.name || '',
        fullPath: node.fullPath || '',
        isDir: true,
      });
    } else {
      appHeader.setSelection(null);
    }

    // Footer: if nothing is hovered, mirror the new selection; if a
    // hover is active the hover subscriber already owns the footer.
    _updateFooterFromState();

    // Right sidebar pane choice mirrors selection kind. File → preview,
    // Commit → commit pane, Directory → street pane, anything else closes.
    if (sel && sel.kind === NodeKind.File) sidebarPane = 'file';
    else if (sel && sel.kind === NodeKind.Commit) sidebarPane = 'commit';
    else if (sel && sel.kind === NodeKind.Directory) sidebarPane = 'street';
    else sidebarPane = null;

    _renderSidebar();
  });

  const _hovUnsub = picker.hover.subscribe((h: PickTarget | null) => {
    if (leftSidebarApi.setHoveredTreePath) {
      leftSidebarApi.setHoveredTreePath(_pathOf(h));
    }

    // Footer follows hover in real time; when hover clears (h === null)
    // _updateFooterFromState falls back to the current selection.
    _updateFooterFromState();
  });

  // Push the freshly-applied manifest into the Info pane so an edited
  // README on disk re-renders without a page reload (live-update poll
  // fires applyManifest, which fires onChange). The header branch pill /
  // repo link now follows the live URL (set by applyNewSource) rather
  // than the manifest, so we only need to keep document.title in sync here.
  const _changeUnsub = world.onChange(() => {
    const m = world.getManifest();
    // manifest.tree.name is already the friendly label — main.ts calls
    // _applyDisplayLabel before every applyManifest, so no mutation needed here.
    // Keep document.title in sync with the now-correct name.
    if (m) {
      const freshLabel = labelFromManifest(m) ?? m.tree?.name ?? '';
      document.title = freshLabel ? `${freshLabel} — codecity` : 'codecity';
    }
    LAST_UPDATED_AT.set(Date.now());
    if (leftSidebarApi.setInfoManifest) {
      leftSidebarApi.setInfoManifest(m);
    }
    if (leftSidebarApi.setTreeManifest && m) {
      leftSidebarApi.setTreeManifest(m);
    }
    if (leftSidebarApi.setSearchManifest) {
      leftSidebarApi.setSearchManifest(m);
    }
    const _selForCommit = picker.selection.get();
    if (_selForCommit && _selForCommit.kind === NodeKind.Commit) {
      const _remote = m?.repo?.remote_url ?? null;
      const _commits = m?.commits ?? [];
      const _sameDayTotal = sameDayCommitCount(_selForCommit.commit, _commits);
      const _color = world.getTrees()?.colorForSha(_selForCommit.commit.sha) ?? undefined;
      commitPane.api.setCommit(_selForCommit.commit, {
        remoteUrl: _remote,
        sameDayTotal: _sameDayTotal,
        color: _color,
      });
    }
    const _selForDir = picker.selection.get();
    if (_selForDir && _selForDir.kind === NodeKind.Directory) {
      // Live-update poll may have swapped the DirNode under us — re-resolve
      // the directory by path from the freshly applied manifest and push the
      // refreshed node into the street pane so counts + extension breakdown
      // stay in sync.
      const refreshed = world.getStreetByDir(_selForDir.dir.path);
      // Prefer the fresh DirNode if available, fall back to stale selection.
      const dir = refreshed?.dir ?? _selForDir.dir;
      streetPane.api.setDirectory(dir);
    }
  });

  function dispose() {
    if (typeof _selUnsub === 'function') _selUnsub();
    if (typeof _hovUnsub === 'function') _hovUnsub();
    if (typeof _changeUnsub === 'function') _changeUnsub();
    if (typeof _liveCfgUnsub === 'function') _liveCfgUnsub();
    if (typeof _statusUnsub === 'function') _statusUnsub();
    if (typeof _errorUnsub === 'function') _errorUnsub();
    if (typeof _stampUnsub === 'function') _stampUnsub();
    window.clearInterval(_tickHandle);
  }

  function setSourceInfo(branch?: string, sourceUrl?: string): void {
    // Derive the friendly label from the new source's manifest so the
    // project-btn updates after a switch. manifest.tree.name is already
    // the friendly label (main.ts._applyDisplayLabel sets it pre-applyManifest).
    const m = world.getManifest();
    const label = labelFromManifest(m) ?? m?.tree?.name ?? '';
    appHeader.setSourceInfo(label, branch, sourceUrl);
  }

  return {
    appHeader,
    appFooter,
    leftSidebarApi,
    dispose,
    setSourceInfo,
  };
}
