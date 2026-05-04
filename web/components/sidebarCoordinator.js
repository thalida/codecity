// components/sidebarCoordinator.js — owns the lifecycle of appHeader,
// appFooter, and leftSidebar, plus the picker → sidebar synchronization.
//
// Subscribes to picker.selection / picker.hover and updates breadcrumb,
// status strip, file/dir details pane, and the tree pane's highlight.
// Also wires tree-row clicks / hovers / focus dispatches back into
// picker + cameraRig so tree-driven actions take the same code path
// canvas-driven actions do.
//
// Public:
//   const coord = createSidebarCoordinator({
//     cityScene, picker, rig,
//     huePalette, applyTheme,
//   });
//   coord.dispose();

import { initAppHeader } from './appHeader.js';
import { initAppFooter } from './appFooter.js';
import { showLeftSidebar } from './leftSidebar.js';
import {
  showFileSidebar, showDirSidebar, showEmptySidebar, hideSidebar,
  humanLanguageFor,
} from './sidebar.js';
import { NODE_KIND } from '../constants.js';


export function createSidebarCoordinator({
  cityScene, picker, rig,
  huePalette, applyTheme,
}) {
  var sidebarVisible = false;

  function _renderSidebar() {
    var sel = picker.selection.get();
    if (!sidebarVisible) { hideSidebar(); return; }
    if (!sel) { showEmptySidebar(); return; }
    if (sel.kind === NODE_KIND.FILE)      showFileSidebar(sel.file);
    else if (sel.kind === NODE_KIND.DIRECTORY) showDirSidebar(sel.dir);
  }

  // ── App header (breadcrumb + L/R sidebar toggles) ──────────────────
  var rootNode = cityScene.getRoot() || {};
  var appHeader = initAppHeader({
    huePalette:     huePalette || {},
    rootLabel:      rootNode.name || '',
    rootPath:       rootNode.path || '',
    onSegmentClick: function (path) { picker.selectByPath(path); },
    onRightToggle:  function (hidden) { sidebarVisible = !hidden; _renderSidebar(); },
  });
  sidebarVisible = appHeader.isRightVisible();
  appHeader.setSelection(null);

  // ── App footer ─────────────────────────────────────────────────────
  var appFooter = initAppFooter();
  appFooter.setSelection({
    kind:  'directory',
    files: rootNode.descendants_file_count || 0,
    dirs:  rootNode.descendants_dir_count  || 0,
    size:  rootNode.descendants_size       || 0,
  });

  _renderSidebar();   // initial paint

  // ── Tree pane (left sidebar) ───────────────────────────────────────
  function _onTreeSelect(node) {
    if (!node || !node.path) return;
    picker.selectByPath(node.path);
  }

  function _onTreeFocus(node) {
    if (!node || !node.path) return;
    if (node.type === NODE_KIND.FILE) {
      var b = cityScene.getBuildingByPath(node.path);
      if (b) rig.focusBuilding(b.mesh, b.building);
    } else if (node.type === NODE_KIND.DIRECTORY) {
      var st = cityScene.getStreetByDir(node.path);
      if (st) rig.focusStreet(st);
    }
  }

  function _onTreeHover(node) {
    if (!node || !node.path) return;
    if (node.type === NODE_KIND.FILE) {
      var b = cityScene.getBuildingByPath(node.path);
      if (!b) return;
      picker.setHover({
        kind: NODE_KIND.FILE, mesh: b.mesh, data: b.building, file: b.building.file,
      });
    } else if (node.type === NODE_KIND.DIRECTORY) {
      var sw = cityScene.getSidewalkByDir(node.path);
      var st = cityScene.getStreetByDir(node.path);
      if (!sw || !st || !st.dir) return;
      picker.setHover({
        kind: NODE_KIND.DIRECTORY, sidewalk: sw, street: st, dir: st.dir,
      });
    }
  }

  function _onTreeHoverEnd() { picker.setHover(null); }

  var leftSidebarApi = showLeftSidebar(cityScene.getManifest(), {
    onResetView:    function () { rig.reset(); },
    applyTheme:     applyTheme || function () {},
    onTreeSelect:   _onTreeSelect,
    onTreeFocus:    _onTreeFocus,
    onTreeHover:    _onTreeHover,
    onTreeHoverEnd: _onTreeHoverEnd,
  });

  function _pathOf(target) {
    if (!target) return null;
    if (target.kind === NODE_KIND.FILE)      return target.file && target.file.path;
    if (target.kind === NODE_KIND.DIRECTORY) return target.dir  && target.dir.path;
    return null;
  }

  // ── picker → sidebar reactions ─────────────────────────────────────
  var _selUnsub = picker.selection.subscribe(function (sel) {
    // Tree highlight follows selection.
    if (leftSidebarApi.setSelectedTreePath) {
      leftSidebarApi.setSelectedTreePath(_pathOf(sel));
    }

    // Breadcrumb tail
    var node = sel && (sel.file || sel.dir);
    appHeader.setSelection(node ? {
      path:      node.path || node.fullPath || node.name || '',
      fullPath:  node.fullPath || '',
      extension: node.extension || '',
      isDir:     sel.kind === NODE_KIND.DIRECTORY,
    } : null);

    // Footer mirrors selection metadata
    if (sel && sel.kind === NODE_KIND.FILE) {
      var f = sel.file || {};
      var hasGit = f.git && (f.git.created || f.git.modified);
      appFooter.setSelection({
        kind:       'file',
        language:   humanLanguageFor(f),
        lines:      f.lines,
        size:       f.size || 0,
        modified:   (f.git && f.git.modified) || f.modified || null,
        created:    (f.git && f.git.created)  || f.created  || null,
        dateSource: hasGit ? 'git' : 'fs',
      });
    } else {
      var d = (sel && sel.dir) || cityScene.getRoot() || {};
      appFooter.setSelection({
        kind:  'directory',
        files: d.descendants_file_count || 0,
        dirs:  d.descendants_dir_count  || 0,
        size:  d.descendants_size       || 0,
      });
    }

    _renderSidebar();
  });

  var _hovUnsub = picker.hover.subscribe(function (h) {
    if (leftSidebarApi.setHoveredTreePath) {
      leftSidebarApi.setHoveredTreePath(_pathOf(h));
    }
  });

  function dispose() {
    if (typeof _selUnsub === 'function') _selUnsub();
    if (typeof _hovUnsub === 'function') _hovUnsub();
  }

  return {
    appHeader: appHeader,
    appFooter: appFooter,
    leftSidebarApi: leftSidebarApi,
    dispose: dispose,
  };
}
