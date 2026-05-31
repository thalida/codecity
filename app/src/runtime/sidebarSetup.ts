// runtime/sidebarSetup.ts — Mounts the right sidebar's selection-driven
// reactions. The left sidebar is now a self-contained Preact component
// (see views/shell/LeftSidebar.tsx) that reads SCENE_HANDLE directly,
// so it no longer needs imperative setup here. App.tsx mounts it as
// JSX. The right sidebar still has imperative pane-mount logic (#36
// will port that next), so its setup stays here for now.

import type { Manifest } from '../types';
import type { SceneHandle } from './manifestStream';
import { mountRightSidebarReactions } from '../views/shell/RightSidebar';

export interface SidebarSetupResult {
  dispose(): void;
}

/**
 * Mount the right sidebar's selection-driven reactions. Returns a
 * dispose() that tears them down on App unmount.
 *
 * The `handle` and `initialManifest` args are accepted for symmetry
 * with the previous left+right setup signature; the right sidebar
 * reaction setup reads SCENE_HANDLE itself.
 */
export function setupSidebars(
  _handle: SceneHandle,
  _initialManifest: Manifest
): SidebarSetupResult {
  const disposeRightSidebar = mountRightSidebarReactions();
  return {
    dispose() {
      disposeRightSidebar();
    },
  };
}
