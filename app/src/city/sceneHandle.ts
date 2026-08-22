// city/sceneHandle.ts — commanding one project's city: waiting for it to
// exist, and the verbs the chrome sends it. Not app state — it holds a
// Three.js object and calls methods on it — and not global: every command
// works on the session it was made for.

import { effect, type Signal } from '@preact/signals';
import type { CityScene } from './types';
import type { FocusMode } from './render/cameraRig';
import type { CitySession } from '@/state/city/session';
import { SIDEBAR_COLLAPSED, dismissSelectionPane, openSelectionPane } from '@/state/stores/chrome';
import { IS_PHONE } from '@/state/stores/viewport';

export type SceneHandle = CityScene;

/** Resolves once this city's scene exists. A boot load can outrun the scene,
 *  and a load that finds none has nowhere to put its manifest. */
export function whenScene(scene: Signal<CityScene | null>): Promise<CityScene> {
  const ready = scene.peek();
  if (ready) return Promise.resolve(ready);
  return new Promise((resolve) => {
    const stop = effect(() => {
      const made = scene.value;
      if (!made) return;
      resolve(made);
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

/** The other half of that choice: you asked for the node by name, so its details
 *  are the answer, and only the phone drawer has to move. */
function revealDetails(): void {
  openSelectionPane();
  collapseDrawerOnPhone();
}

/** The verbs the chrome sends one project's city. All no-op before its scene
 *  boots, and none of them can reach another session's. */
export interface CityCommands {
  hoverPath(path: string): void;
  clearHover(): void;
  clearSelection(): void;
  focusPath(path: string, mode?: FocusMode): void;
  focusCommit(sha: string, mode?: FocusMode): void;
  focusSelection(mode?: FocusMode): void;
  goToPath(path: string, mode?: FocusMode): void;
  goToCommit(sha: string, mode?: FocusMode): void;
  showCommit(sha: string): void;
  resetView(): void;
  runCollisionCheck(): void;
  runStemDiagnostic(): void;
  runTreeGroundingCheck(): void;
}

export function createCityCommands(session: CitySession): CityCommands {
  const city = session.scene;

  /** What a command points the camera at: a node by path, a commit by sha, or
   *  whatever is already selected. */
  type NodeRef = { path: string } | { sha: string } | null;

  /** Select what `ref` names and aim the camera at it: the one place a ref becomes
   *  a focus. False when there is nothing to look at, so the chrome stays put. */
  function _pointAt(ref: NodeRef, mode?: FocusMode): boolean {
    const handle = city.peek();
    if (!handle) return false;
    const sel =
      ref === null
        ? handle.picker.selection.peek()
        : 'sha' in ref
          ? handle.picker.selectByCommit(ref.sha)
          : handle.picker.selectByPath(ref.path);
    if (!sel) return false;
    handle.rig.focusSelection(sel, mode);
    return true;
  }

  // Thin wrappers the UI calls instead of reaching into the handle itself. All
  // no-op before the scene boots.

  /** Hover-highlight the node at `path` (tree-row hover → city highlight). */
  function hoverPath(path: string): void {
    city.peek()?.picker.hoverByPath(path);
  }

  /** Clear the hover highlight. */
  function clearHover(): void {
    city.peek()?.picker.setHover(null);
  }

  /** Clear the current selection (closes the contextual right sidebar). */
  function clearSelection(): void {
    city.peek()?.picker.clearSelection();
  }

  /** Focus a node, selecting it first if it isn't: an almanac row is a Focus
   *  button for something you haven't picked yet. Re-selecting is identity. */
  function focusPath(path: string, mode?: FocusMode): void {
    if (_pointAt({ path }, mode)) revealCity();
  }

  /** focusPath for a commit's tree, by sha. */
  function focusCommit(sha: string, mode?: FocusMode): void {
    if (_pointAt({ sha }, mode)) revealCity();
  }

  /** Focus whatever is selected, whichever kind. Here rather than in the key
   *  handler: a keystroke and a Focus button are the same request. */
  function focusSelection(mode?: FocusMode): void {
    if (_pointAt(null, mode)) revealCity();
  }

  /** Go to a node named in a list. The details open, unlike the Focus commands:
   *  there you act on what's in front of you, here you asked for the name. */
  function goToPath(path: string, mode?: FocusMode): void {
    if (_pointAt({ path }, mode)) revealDetails();
  }

  /** goToPath for a commit's tree, by sha (almanac landmarks). */
  function goToCommit(sha: string, mode?: FocusMode): void {
    if (_pointAt({ sha }, mode)) revealDetails();
  }

  /** A commit's details, with the camera left alone: the timeline's own row,
   *  where you are already looking at what you asked about. */
  function showCommit(sha: string): void {
    const handle = city.peek();
    if (!handle) return;
    handle.picker.selectByCommit(sha);
    openSelectionPane();
  }

  /** Reset the camera framing to the current mode's default pose. */
  function resetView(): void {
    city.peek()?.rig.reset();
  }

  /** Debug: run the building/street collision check. */
  function runCollisionCheck(): void {
    city.peek()?.world.runCollisionCheck();
  }

  /** Debug: run the stem-placement diagnostic. */
  function runStemDiagnostic(): void {
    city.peek()?.world.runStemPlacementDiagnostic();
  }

  /** Debug: audit every tree's contact with the ground. */
  function runTreeGroundingCheck(): void {
    city.peek()?.world.runTreeGroundingDiagnostic();
  }

  return {
    hoverPath,
    clearHover,
    clearSelection,
    focusPath,
    focusCommit,
    focusSelection,
    goToPath,
    goToCommit,
    showCommit,
    resetView,
    runCollisionCheck,
    runStemDiagnostic,
    runTreeGroundingCheck,
  };
}
