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
//     cityScene, picker, rig,
//     huePalette, applyTheme,
//   });
//   coord.dispose();

import { initAppHeader } from './views/shell/appHeader.js';
import { initAppFooter } from './views/shell/appFooter.js';
import { showLeftSidebar } from './views/shell/leftSidebar.js';
import { showRightSidebar, hideRightSidebar } from './views/shell/rightSidebar.js';
import { buildFilePreviewPane, humanLanguageFor } from './views/panes/filePreviewPane.js';
import { DateSource, NodeKind } from './types';
import type { DirNode, FileNode, PickTarget, TreeNode } from './types';
import type { createCityScene } from './scene/cityScene.js';
import type { createPicker } from './scene/picker.js';
import type { createCameraRig } from './scene/cameraRig.js';

interface CoordinatorOpts {
  cityScene: ReturnType<typeof createCityScene>;
  picker: ReturnType<typeof createPicker>;
  rig: ReturnType<typeof createCameraRig>;
  huePalette: Record<string, number>;
  applyTheme: () => void;
}

export function createCoordinator({
  cityScene,
  picker,
  rig,
  huePalette,
  applyTheme,
}: CoordinatorOpts) {
  let sidebarVisible = false;

  // Build the right-sidebar's file-preview pane once. The shell mounts
  // it on first show; subsequent selection changes just push a new file
  // target into it via the pane's setFile API.
  const filePreview = buildFilePreviewPane();

  function _renderSidebar(): void {
    if (!sidebarVisible) {
      hideRightSidebar();
      return;
    }
    showRightSidebar(filePreview.pane);
    const sel: PickTarget | null = picker.selection.get();
    // Directories collapse to the same empty "select a file" state as
    // no-selection — the file-preview pane has nothing to show for a
    // directory pick.
    if (sel && sel.kind === NodeKind.File) filePreview.api.setFile(sel.file);
    else filePreview.api.setFile(null);
  }

  // ── App header (breadcrumb + L/R sidebar toggles) ──────────────────
  const rootNode: DirNode | null = cityScene.getRoot();
  const appHeader = initAppHeader({
    huePalette: huePalette || {},
    rootLabel: rootNode?.name || '',
    rootPath: rootNode?.path || '',
    onSegmentClick(path: string) {
      picker.selectByPath(path);
    },
    onRightToggle(hidden: boolean) {
      sidebarVisible = !hidden;
      _renderSidebar();
    },
  });
  sidebarVisible = appHeader.isRightVisible();
  appHeader.setSelection(null);

  // ── App footer ─────────────────────────────────────────────────────
  const appFooter = initAppFooter();
  appFooter.setSelection({
    kind: NodeKind.Directory,
    files: rootNode?.descendants_file_count ?? 0,
    dirs: rootNode?.descendants_dir_count ?? 0,
    size: rootNode?.descendants_size ?? 0,
  });

  _renderSidebar(); // initial paint

  // ── Tree pane (left sidebar) ───────────────────────────────────────
  function _onTreeSelect(node: TreeNode): void {
    if (!node || !node.path) return;
    picker.selectByPath(node.path);
  }

  function _onTreeFocus(node: TreeNode): void {
    if (!node || !node.path) return;
    if (node.type === NodeKind.File) {
      const b = cityScene.getBuildingByPath(node.path);
      if (b) rig.focusBuilding(b.mesh, b.building);
    } else if (node.type === NodeKind.Directory) {
      const st = cityScene.getStreetByDir(node.path);
      if (st) rig.focusStreet(st, null);
    }
  }

  function _onTreeHover(node: TreeNode): void {
    if (!node || !node.path) return;
    if (node.type === NodeKind.File) {
      const b = cityScene.getBuildingByPath(node.path);
      if (!b) return;
      picker.setHover({
        kind: NodeKind.File,
        mesh: b.mesh,
        data: b.building,
        file: b.building.file,
      });
    } else if (node.type === NodeKind.Directory) {
      const sw = cityScene.getSidewalkByDir(node.path);
      const st = cityScene.getStreetByDir(node.path);
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

  const manifest = cityScene.getManifest();
  const leftSidebarApi = showLeftSidebar(manifest!, {
    onResetView() {
      rig.reset();
    },
    applyTheme: applyTheme || function () {},
    onTreeSelect: _onTreeSelect,
    onTreeFocus: _onTreeFocus,
    onTreeHover: _onTreeHover,
    onTreeHoverEnd: _onTreeHoverEnd,
  });

  function _pathOf(target: PickTarget | null): string | null {
    if (!target) return null;
    if (target.kind === NodeKind.File) return target.file?.path ?? null;
    if (target.kind === NodeKind.Directory) return target.dir?.path ?? null;
    return null;
  }

  // ── picker → sidebar reactions ─────────────────────────────────────
  const _selUnsub = picker.selection.subscribe((sel: PickTarget | null) => {
    // Tree highlight follows selection.
    if (leftSidebarApi.setSelectedTreePath) {
      leftSidebarApi.setSelectedTreePath(_pathOf(sel));
    }

    // Breadcrumb tail
    const node: FileNode | DirNode | null = sel
      ? sel.kind === NodeKind.File
        ? sel.file
        : sel.kind === NodeKind.Directory
          ? sel.dir
          : null
      : null;
    appHeader.setSelection(
      node && sel
        ? {
            path: node.path || node.fullPath || node.name || '',
            fullPath: node.fullPath || '',
            extension: 'extension' in node ? node.extension || '' : '',
            isDir: sel.kind === NodeKind.Directory,
          }
        : null
    );

    // Footer mirrors selection metadata
    if (sel && sel.kind === NodeKind.File) {
      const f: FileNode = sel.file;
      const hasGit = !!(f.git && (f.git.created || f.git.modified));
      appFooter.setSelection({
        kind: NodeKind.File,
        language: humanLanguageFor(f),
        lines: f.lines,
        size: f.size || 0,
        modified: (f.git && f.git.modified) || f.modified || null,
        created: (f.git && f.git.created) || f.created || null,
        dateSource: hasGit ? DateSource.Git : DateSource.Filesystem,
      });
    } else {
      const d: DirNode | null =
        (sel && sel.kind === NodeKind.Directory ? sel.dir : null) || cityScene.getRoot();
      appFooter.setSelection({
        kind: NodeKind.Directory,
        files: d?.descendants_file_count ?? 0,
        dirs: d?.descendants_dir_count ?? 0,
        size: d?.descendants_size ?? 0,
      });
    }

    _renderSidebar();
  });

  const _hovUnsub = picker.hover.subscribe((h: PickTarget | null) => {
    if (leftSidebarApi.setHoveredTreePath) {
      leftSidebarApi.setHoveredTreePath(_pathOf(h));
    }
  });

  // Push the freshly-applied manifest into the Info pane so an edited
  // README on disk re-renders without a page reload (live-update poll
  // fires applyManifest, which fires onChange).
  const _changeUnsub = cityScene.onChange(() => {
    if (leftSidebarApi.setInfoManifest) {
      leftSidebarApi.setInfoManifest(cityScene.getManifest());
    }
  });

  function dispose() {
    if (typeof _selUnsub === 'function') _selUnsub();
    if (typeof _hovUnsub === 'function') _hovUnsub();
    if (typeof _changeUnsub === 'function') _changeUnsub();
  }

  return {
    appHeader,
    appFooter,
    leftSidebarApi,
    dispose,
  };
}
