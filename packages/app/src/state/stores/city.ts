// state/stores/city.ts — the cities this app has mounted, and the commands its
// chrome sends them.
//
// The commands are thin on purpose. Pointing the camera at a node is the city's
// job and lives there (`city.focus`); deciding what the screen should look like
// afterwards is ours, and that is all these add. The split is what makes the
// landing's wallpaper possible: it is a city with no chrome, so it simply has
// none of this pointed at it.

import type { City, FocusRef, PickerSelectionKey, PickTarget, FocusMode } from '@codecity/city';
import { signal, effect } from '@preact/signals';
import {
  OVERLAY_OPEN,
  SIDEBAR_COLLAPSED,
  dismissSelectionPane,
  openSelectionPane,
} from '@/state/stores/chrome';
import { IS_PHONE } from '@/state/stores/viewport';

export type SceneHandle = City;

/** The city on the /city route. Only the Scene variant publishes here. */
export const SCENE_HANDLE = signal<City | null>(null);

/** The landing's wallpaper city: a different city on a different canvas, so
 *  sharing a slot made whichever mounted last the other's applyManifest target. */
export const BACKDROP_HANDLE = signal<City | null>(null);

/** Resolves once the city exists. A boot load can outrun createCity, and a load
 *  that finds no handle has nowhere to put its city. */
export function whenSceneHandle(): Promise<City> {
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
 *  clears what's in the way and leaves the chip standing in for the details.
 *  Exported because the focus key does the same thing from inside the canvas. */
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

/** This app's chrome reaction to a command: a focus asks to LOOK at the node,
 *  so the details get out of the way; a go-to names it, so the details are the
 *  answer. Both are decisions about this app's screen, which is why they are
 *  here and `city.focus` is not. */
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

/** Bind this app's chrome to ONE city. Every command is that city's, plus what
 *  this app does to its own screen afterwards; nothing here reaches for a
 *  particular city, so a second one on the page can be driven the same way.
 *
 *  Takes a getter rather than a city: the chrome outlives any one instance, and
 *  a command issued before the canvas mounts is a no-op rather than a crash. */
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

/** The scene city's, which is what this app's chrome talks to. One binding, in
 *  one place: the wallpaper on the landing has no chrome, so it gets none. */
export const SCENE_COMMANDS = cityCommands(() => SCENE_HANDLE.peek());

// Named for the call sites, which read as sentences: `goToPath(p)` is what a
// list row does. They are this app's scene commands and nothing else's.
export const {
  hoverPath,
  clearHover,
  clearSelection,
  focusPath,
  focusCommit,
  focusSelection,
  goToPath,
  goToCommit,
} = SCENE_COMMANDS;

/** A commit's details, with the camera left alone: the timeline's own row,
 *  where you are already looking at what you asked about. */
export function showCommit(sha: string): void {
  const handle = SCENE_HANDLE.peek();
  if (!handle) return;
  handle.picker.selectByCommit(sha);
  openSelectionPane();
}

/** What the scene city has selected, as the identity that outlives its meshes.
 *  The city holds this too (it re-resolves the selection across rebuilds); this
 *  is the app's copy, kept current from the same event the chrome reacts to,
 *  because the URL is rendered off signals. */
export const PICKER_SELECTION_KEY = signal<PickerSelectionKey | null>(null);

/** What the scene city has hovered and selected. The city holds these as plain
 *  values and says when they change; the chrome renders off signals, so this is
 *  where the two meet. Kept current by attachCityChrome. */
export const CITY_HOVER = signal<PickTarget | null>(null);
export const CITY_SELECTION = signal<PickTarget | null>(null);

/** Wire one city's own inputs to this app's chrome. The city reports what the
 *  reader did in the canvas; deciding what the screen does about it is ours,
 *  and only the city with chrome around it gets this pointed at it.
 *
 *  Returns the unsubscribe; call it when that city goes away. */
export function attachCityChrome(on: City['on']): () => void {
  const offs = [
    // Picking a node is asking what it is, so a pane put away for the last one
    // comes back for this one — and re-picking the same node is the way back
    // to a pane you closed.
    on('pick', () => openSelectionPane()),
    // The focus key is the same request the panes' Focus buttons make, so it
    // gets the same chrome.
    on('focus', () => revealCityChrome()),
    // The key travels with the target: a target holds meshes a rebuild will
    // stale, and the key is what survives it (the URL is written off the key).
    on('select', () => {
      const picker = SCENE_HANDLE.peek()?.picker;
      CITY_SELECTION.value = picker?.selection ?? null;
      PICKER_SELECTION_KEY.value = picker?.selectionKey ?? null;
    }),
    on('hover', () => void (CITY_HOVER.value = SCENE_HANDLE.peek()?.picker.hover ?? null)),
  ];
  return () => {
    for (const off of offs) off();
  };
}

/** Whether the city's own shortcuts should fire. A modal owns the keyboard
 *  while it is open, which the city has no way to know. */
export function cityKeyboardEnabled(): boolean {
  return !OVERLAY_OPEN.peek();
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
