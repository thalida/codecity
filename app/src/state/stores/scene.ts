// state/stores/scene.ts — Runtime signal that holds the Three.js scene
// handle once CenterPane mounts and createCity completes. Components
// that need world / picker / rig read SCENE_HANDLE.value?.world etc.
// Null until CenterPane's useEffect resolves.

import { signal } from '@preact/signals';
import type { createCity } from '../../city';
import { SIDEBAR_COLLAPSED, dismissSelectionPane, openSelectionPane } from './ui';
import { IS_PHONE } from './viewport';

export type SceneHandle = Awaited<ReturnType<typeof createCity>>;

export const SCENE_HANDLE = signal<SceneHandle | null>(null);

/** Phone: the left drawer covers the city, so a camera move behind it is one you
 *  can't see. It's the whole screen there and a column everywhere else. */
function collapseDrawerOnPhone(): void {
  if (IS_PHONE.peek()) SIDEBAR_COLLAPSED.value = true;
}

/** Asking to focus something is asking to look at it, so every focus command
 *  clears what's in the way and leaves the chip standing in for the details. */
function revealCity(): void {
  dismissSelectionPane();
  collapseDrawerOnPhone();
}

// Thin wrappers the UI calls instead of reaching into the handle itself. All
// no-op before the scene boots.

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

/** Focus a node, selecting it first if it isn't: an almanac row is a Focus
 *  button for something you haven't picked yet. Re-selecting is identity. */
export function focusPath(path: string): void {
  const handle = SCENE_HANDLE.peek();
  if (!handle) return;
  handle.picker.selectByPath(path);
  handle.focusByPath(path);
  revealCity();
}

/** focusPath for a commit's tree, by sha. */
export function focusCommit(sha: string): void {
  const handle = SCENE_HANDLE.peek();
  if (!handle) return;
  handle.picker.selectByCommit(sha);
  handle.rig.focusTree(sha);
  revealCity();
}

/** Focus whatever is selected, whichever kind. Here rather than in the key
 *  handler: a keystroke and a Focus button are the same request. */
export function focusSelection(): void {
  const handle = SCENE_HANDLE.peek();
  if (!handle) return;
  const sel = handle.picker.selection.peek();
  if (!sel) return; // nothing to look at, so nothing to clear out of the way
  handle.rig.focusSelection(sel);
  revealCity();
}

/** Go to a node named in a list. The details open, unlike the Focus commands:
 *  there you act on what's in front of you, here you asked for the name. */
export function goToPath(path: string): void {
  const handle = SCENE_HANDLE.peek();
  if (!handle) return;
  handle.picker.selectByPath(path);
  handle.focusByPath(path);
  openSelectionPane();
  collapseDrawerOnPhone();
}

/** goToPath for a commit's tree, by sha (almanac landmarks). */
export function goToCommit(sha: string): void {
  const handle = SCENE_HANDLE.peek();
  if (!handle) return;
  handle.picker.selectByCommit(sha);
  handle.rig.focusTree(sha);
  openSelectionPane();
  collapseDrawerOnPhone();
}

/** A commit's details, with the camera left alone: the timeline's own row,
 *  where you are already looking at what you asked about. */
export function showCommit(sha: string): void {
  const handle = SCENE_HANDLE.peek();
  if (!handle) return;
  handle.picker.selectByCommit(sha);
  openSelectionPane();
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

/** Debug: audit every tree's contact with the ground. */
export function runTreeGroundingCheck(): void {
  SCENE_HANDLE.peek()?.world.runTreeGroundingDiagnostic();
}
