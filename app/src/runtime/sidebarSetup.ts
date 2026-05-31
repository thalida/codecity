// runtime/sidebarSetup.ts — Mounts left + right sidebars after the scene
// handle is available. Called once from the boot orchestrator after
// streamInitialManifest completes.

import { NodeKind } from '../types';
import type { Manifest } from '../types';
import type { SceneHandle } from './manifestStream';
import { showLeftSidebar } from '../views/shell/LeftSidebar';
import { mountRightSidebarReactions } from '../views/shell/RightSidebar';

export interface SidebarSetupResult {
  dispose(): void;
}

/**
 * Mount the left and right sidebars with scene-handle callbacks.
 * Returns a dispose() that tears them down on App unmount.
 */
export function setupSidebars(
  handle: SceneHandle,
  initialManifest: Manifest
): SidebarSetupResult {
  const leftSidebarApi = showLeftSidebar(initialManifest, {
    onResetView() { handle.rig.reset(); },
    applyTheme: handle.applyTheme ?? (() => {}),
    onTreeSelect(node) {
      if (!node?.path) return;
      handle.picker.selectByPath(node.path);
    },
    onTreeFocus(node) {
      if (!node?.path) return;
      if (node.type === NodeKind.File) {
        const b = handle.world.getBuildingByPath(node.path);
        if (b) handle.rig.focusBuilding(b.mesh, b.building);
      } else if (node.type === NodeKind.Directory) {
        const st = handle.world.getStreetByDir(node.path);
        if (st) handle.rig.focusStreet(st, null);
      }
    },
    onTreeHover(node) {
      if (!node?.path) return;
      if (node.type === NodeKind.File) {
        const b = handle.world.getBuildingByPath(node.path);
        if (!b) return;
        handle.picker.setHover({ kind: NodeKind.File, mesh: b.mesh, data: b.building, file: b.building.file });
      } else if (node.type === NodeKind.Directory) {
        const sw = handle.world.getSidewalkByDir(node.path);
        const st = handle.world.getStreetByDir(node.path);
        if (!sw || !st || !st.dir) return;
        handle.picker.setHover({ kind: NodeKind.Directory, sidewalk: sw, street: st, dir: st.dir });
      }
    },
    onTreeHoverEnd() { handle.picker.setHover(null); },
    onSearchSelect(path) { handle.picker.selectByPath(path); },
    onSearchFocus(path) {
      const b = handle.world.getBuildingByPath(path);
      if (b) handle.rig.focusBuilding(b.mesh, b.building);
    },
    onRunCollisionCheck: () => handle.world.runCollisionCheck(),
    onRunStemDiagnostic: () => handle.world.runStemPlacementDiagnostic(),
  });

  const disposeRightSidebar = mountRightSidebarReactions();

  return {
    dispose() {
      if (leftSidebarApi && 'dispose' in leftSidebarApi) {
        (leftSidebarApi as { dispose(): void }).dispose();
      }
      disposeRightSidebar();
    },
  };
}
