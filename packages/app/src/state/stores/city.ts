// state/stores/city.ts — the commands this app's chrome sends a city.
//
// Thin on purpose: pointing the camera is the city's job (`city.focus`), and
// what the screen does afterwards is ours. All these add is the second half.

import type { City, FocusRef, FocusMode } from '@codecity/city';
import {
  OVERLAY_OPEN,
  SIDEBAR_COLLAPSED,
  dismissSelectionPane,
  openSelectionPane,
} from '@/state/stores/chrome';
import { IS_PHONE } from '@/state/stores/viewport';

/** Phone: the left drawer covers the city, so a camera move behind it is one you
 *  can't see. It's the whole screen there and a column everywhere else. */
function collapseDrawerOnPhone(): void {
  if (IS_PHONE.peek()) SIDEBAR_COLLAPSED.value = true;
}

/** Focusing is asking to LOOK at something, so it clears what is in the way.
 *  Exported because the focus key does the same from inside the canvas. */
export function revealCityChrome(): void {
  dismissSelectionPane();
  collapseDrawerOnPhone();
}

/** The other half of that choice: you asked for the node by name, so its details
 *  are the answer, and only the phone drawer has to move. */
function revealDetails(): void {
  openSelectionPane();
  collapseDrawerOnPhone();
}

/** A focus asks to LOOK at the node, so the details get out of the way; a
 *  go-to names it, so the details are the answer. Both are screen decisions. */
export interface CityCommands {
  /** Hover-highlight the node at `path` (tree-row hover → city highlight). */
  hoverPath(path: string): void;
  clearHover(): void;
  /** Clear the current selection (closes the contextual right sidebar). */
  clearSelection(): void;
  /** Focus a node, selecting it first if it isn't: an almanac row is a Focus
   *  button for something you haven't picked yet. Re-selecting is identity. */
  focusPath(path: string, mode?: FocusMode): void;
  /** focusPath for a commit's tree, by sha. */
  focusCommit(sha: string, mode?: FocusMode): void;
  /** Focus whatever is selected, whichever kind. Here rather than in the key
   *  handler: a keystroke and a Focus button are the same request. */
  focusSelection(mode?: FocusMode): void;
  /** Go to a node named in a list. The details open, unlike the Focus commands:
   *  there you act on what's in front of you, here you asked for the name. */
  goToPath(path: string, mode?: FocusMode): void;
  /** goToPath for a commit's tree, by sha (almanac landmarks). */
  goToCommit(sha: string, mode?: FocusMode): void;
}

/** Bind this app's chrome to ONE city. A getter, so a command sent before the
 *  canvas mounts is a no-op rather than a crash. */
export function cityCommands(cityOf: () => City | null): CityCommands {
  /** False before it boots, or when there is nothing there to look at — so the
   *  chrome stays put rather than clearing itself for nothing. */
  const pointAt = (ref: FocusRef, mode?: FocusMode): boolean => cityOf()?.focus(ref, mode) ?? false;

  return {
    hoverPath: (path) => cityOf()?.picker.hoverByPath(path),
    clearHover: () => cityOf()?.picker.setHover(null),
    clearSelection: () => cityOf()?.picker.clearSelection(),
    focusPath: (path, mode) => void (pointAt({ path }, mode) && revealCityChrome()),
    focusCommit: (sha, mode) => void (pointAt({ sha }, mode) && revealCityChrome()),
    focusSelection: (mode) => void (pointAt(null, mode) && revealCityChrome()),
    goToPath: (path, mode) => void (pointAt({ path }, mode) && revealDetails()),
    goToCommit: (sha, mode) => void (pointAt({ sha }, mode) && revealDetails()),
  };
}

/** A commit's details, with the camera left alone: the timeline's own row,
 *  where you are already looking at what you asked about. */
export function showCommit(city: City | null, sha: string): void {
  if (!city) return;
  city.picker.selectByCommit(sha);
  openSelectionPane();
}

/** Whether the city's own shortcuts should fire. A modal owns the keyboard
 *  while it is open, which the city has no way to know. */
export function cityKeyboardEnabled(): boolean {
  return !OVERLAY_OPEN.peek();
}

/** Debug: run the building/street collision check. */
export function runCollisionCheck(city: City | null): void {
  city?.world.runCollisionCheck();
}

/** Debug: run the stem-placement diagnostic. */
export function runStemDiagnostic(city: City | null): void {
  city?.world.runStemPlacementDiagnostic();
}

/** Debug: audit every tree's contact with the ground. */
export function runTreeGroundingCheck(city: City | null): void {
  city?.world.runTreeGroundingDiagnostic();
}
