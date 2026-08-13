// state/stores/scene.ts — Runtime signal that holds the Three.js scene
// handle once CenterPane mounts and createCity completes. Components
// that need world / picker / rig read SCENE_HANDLE.value?.world etc.
// Null until CenterPane's useEffect resolves.

import { computed, effect, signal } from '@preact/signals';
import type { createCity } from '../../city';
import { NodeKind } from '@/types';
import { SIDEBAR_COLLAPSED, dismissSelectionPane, openSelectionPane } from './ui';
import { IS_PHONE } from './viewport';

export type SceneHandle = Awaited<ReturnType<typeof createCity>>;

export const SCENE_HANDLE = signal<SceneHandle | null>(null);

/** Identity of what's selected. The picker hands back a fresh target object on
 *  every world rebuild, and a new object is not a new selection. */
export const SELECTION_KEY = computed<string | null>(() => {
  const sel = SCENE_HANDLE.value?.picker.selection.value ?? null;
  if (sel?.kind === NodeKind.File) return `f:${sel.file.path}`;
  if (sel?.kind === NodeKind.Directory) return `d:${sel.dir.path}`;
  if (sel?.kind === NodeKind.Commit) return `c:${sel.commit.sha}`;
  return null;
});

// A dismissal belongs to the selection that was standing when you closed the
// pane, so any change of selection ends it — including landing back on the same
// node later, which the key alone can't tell apart from never having left it.
// Rebuilds hand back a fresh target for the same node, but the key is unchanged
// there, so the computed doesn't notify and the dismissal survives.
effect(() => {
  void SELECTION_KEY.value;
  openSelectionPane();
});

/** Asking to focus something is asking to look at it, so every focus command
 *  clears what's in the way and leaves the chip standing in for the details.
 *  The left drawer only covers the city on a phone; the panel crowds it
 *  everywhere. */
function revealCity(): void {
  dismissSelectionPane();
  if (IS_PHONE.peek()) SIDEBAR_COLLAPSED.value = true;
}

// ── Scene commands ───────────────────────────────────────────────────
// Thin, null-safe wrappers UI components call instead of each reaching into
// SCENE_HANDLE.peek()?.picker / rig / world themselves (same store+actions
// shape as stores/ui.ts). All no-op before the scene boots (handle null).

/** Select the node at `path` (tree-row / breadcrumb clicks). */
export function selectPath(path: string): void {
  SCENE_HANDLE.peek()?.picker.selectByPath(path);
}

/** Select a commit's tree by sha (almanac landmark clicks). */
export function selectCommit(sha: string): void {
  SCENE_HANDLE.peek()?.picker.selectByCommit(sha);
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
  revealCity();
}

/** Focus the camera on a commit's tree by sha. */
export function focusCommit(sha: string): void {
  SCENE_HANDLE.peek()?.rig.focusTree(sha);
  revealCity();
}

/** Focus the camera on whatever is selected, whichever kind it is (the F key).
 *  Here rather than in the key handler so it clears the way like every other
 *  focus command: a keystroke and a Focus button are the same request. */
export function focusSelection(): void {
  const handle = SCENE_HANDLE.peek();
  if (!handle) return;
  const sel = handle.picker.selection.peek();
  if (!sel) return; // nothing to look at, so nothing to clear out of the way
  handle.rig.focusSelection(sel);
  revealCity();
}

/** Reset the camera framing to the current mode's default pose. */
export function resetView(): void {
  SCENE_HANDLE.peek()?.rig.reset();
}

/** Debug: run the building/street collision check. */
export function runCollisionCheck(): void {
  SCENE_HANDLE.peek()?.world.runCollisionCheck();
}

/** Debug: run the stem-placement diagnostic. */
export function runStemDiagnostic(): void {
  SCENE_HANDLE.peek()?.world.runStemPlacementDiagnostic();
}
