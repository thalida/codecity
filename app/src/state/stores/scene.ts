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

// ── Scene commands ───────────────────────────────────────────────────
// Thin, null-safe wrappers UI components call instead of each reaching into
// SCENE_HANDLE.peek()?.picker / rig / world themselves (same store+actions
// shape as stores/ui.ts). All no-op before the scene boots (handle null).

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

/** Focus the camera on the node at `path`, selecting it if it isn't already —
 *  a pane's Focus button acts on the current selection, an almanac row is a
 *  focus button for a node you haven't picked yet. Selecting what's already
 *  selected re-resolves to the same identity, so the panel doesn't reopen
 *  underneath the dismissal this is about to make. */
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

/** Go to a node named in a list: the tree, a search hit, an almanac landmark.
 *  Select it, put the camera on it, and show its details.
 *
 *  The opposite of the Focus commands where the panel is concerned, and
 *  deliberately: those act on something already in front of you, so the details
 *  are what's in the way. Here you picked a name out of a list and the details
 *  are the thing you asked for, so they open even if you'd put them away for
 *  this same node earlier. */
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
