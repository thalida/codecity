// state/stores/scene.ts — Runtime signal that holds the Three.js scene
// handle once CenterPane mounts and startRenderLoop completes. Components
// that need world / picker / rig read SCENE_HANDLE.value?.world etc.
// Null until CenterPane's useEffect resolves.

import { signal } from '@preact/signals';
import type { startRenderLoop } from '../../scene/renderLoop';

export type SceneHandle = Awaited<ReturnType<typeof startRenderLoop>>;

export const SCENE_HANDLE = signal<SceneHandle | null>(null);

// ── Scene commands ───────────────────────────────────────────────────
// Thin, null-safe wrappers UI components call instead of each reaching into
// SCENE_HANDLE.peek()?.picker / rig / world themselves (same store+actions
// shape as stores/ui.ts). All no-op before the scene boots (handle null).

/** Select the node at `path` (tree-row / breadcrumb clicks). */
export function selectPath(path: string): void {
  SCENE_HANDLE.peek()?.picker.selectByPath(path);
}

/** Hover-highlight the node at `path` (tree-row hover → city highlight). */
export function hoverPath(path: string): void {
  SCENE_HANDLE.peek()?.picker.hoverByPath(path);
}

/** Clear the hover highlight. */
export function clearHover(): void {
  SCENE_HANDLE.peek()?.picker.setHover(null);
}

/** Clear the current selection (closes the contextual right sidebar). */
export function clearSelection(): void {
  SCENE_HANDLE.peek()?.picker.clearSelection();
}

/** Focus the camera on the node at `path`. */
export function focusPath(path: string): void {
  SCENE_HANDLE.peek()?.focusByPath(path);
}

/** Focus the camera on a commit's tree by sha. */
export function focusCommit(sha: string): void {
  SCENE_HANDLE.peek()?.rig.focusTree(sha);
}

/** Focus the camera on whatever is currently selected (the F shortcut). */
export function focusCurrentSelection(): void {
  const handle = SCENE_HANDLE.peek();
  handle?.rig.focusSelection(handle.picker.selection.peek());
}

/** Reset the camera framing to the current mode's default pose. */
export function resetView(): void {
  SCENE_HANDLE.peek()?.resetView();
}

/** Debug: run the building/street collision check. */
export function runCollisionCheck(): void {
  SCENE_HANDLE.peek()?.world.runCollisionCheck();
}

/** Debug: run the stem-placement diagnostic. */
export function runStemDiagnostic(): void {
  SCENE_HANDLE.peek()?.world.runStemPlacementDiagnostic();
}
