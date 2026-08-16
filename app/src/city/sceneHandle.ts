// city/sceneHandle.ts — the live scene handle, and the commands the UI sends
// through it. Not app state: it holds a Three.js object and calls methods on
// it, so it lives with the renderer rather than in state/stores.

import { signal, effect } from '@preact/signals';
import type { createCity } from './index';
import { FocusMode } from './render/cameraRig';
import { SIDEBAR_COLLAPSED, dismissSelectionPane, openSelectionPane } from '@/state/stores/chrome';
import { IS_PHONE } from '@/state/stores/viewport';

export type SceneHandle = Awaited<ReturnType<typeof createCity>>;

export const SCENE_HANDLE = signal<SceneHandle | null>(null);

/** Resolves once the city exists. A boot load can outrun createCity, and a load
 *  that finds no handle has nowhere to put its city. */
export function whenSceneHandle(): Promise<SceneHandle> {
  const ready = SCENE_HANDLE.peek();
  if (ready) return Promise.resolve(ready);
  return new Promise((resolve) => {
    const stop = effect(() => {
      const handle = SCENE_HANDLE.value;
      if (!handle) return;
      resolve(handle);
      queueMicrotask(() => stop());
    });
  });
}

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

/** Restore a selection the URL names: pick it out, open its details, and slide
 *  the city until it sits centred, under the angle and zoom the load framed. */
export function restorePath(path: string): void {
  const handle = SCENE_HANDLE.peek();
  if (!handle) return;
  handle.picker.selectByPath(path);
  handle.focusByPath(path, FocusMode.Recenter);
  openSelectionPane();
  collapseDrawerOnPhone();
}

/** restorePath for a commit's tree, by sha. */
export function restoreCommit(sha: string): void {
  const handle = SCENE_HANDLE.peek();
  if (!handle) return;
  handle.picker.selectByCommit(sha);
  handle.rig.focusTree(sha, FocusMode.Recenter);
  openSelectionPane();
  collapseDrawerOnPhone();
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
