// city/commands.ts — commanding one city's scene: waiting for it to exist, and
// the verbs the chrome sends it. Not app state (it holds a Three.js object and
// calls methods on it) and not global: every command works on the session it
// was made for, so the chrome can only ever move the city it is looking at.

import { type Signal } from '@preact/signals';
import { until } from '@/utils/until';
import type { CityScene } from './types';
import type { FocusMode } from './render/cameraRig';
import type { CitySession } from '@/state/city/session';
import { SIDEBAR_COLLAPSED, dismissSelectionPane, openSelectionPane } from '@/state/stores/chrome';
import { IS_PHONE } from '@/state/stores/viewport';

/** Resolves once this city's scene exists. A boot load can outrun the scene,
 *  and a load that finds none has nowhere to put its manifest. */
export async function whenScene(scene: Signal<CityScene | null>): Promise<CityScene> {
  await until(() => scene.value !== null);
  return scene.peek()!;
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

/** What a command points the camera at: a node by path, a commit by sha, or
 *  whatever is already selected. */
type NodeRef = { path: string } | { sha: string } | null;

/** The verbs the chrome sends one city. All no-op before its scene boots, and
 *  none of them can reach another session's: the scene comes from this one. */
export class CityCommands {
  constructor(private readonly session: CitySession) {}

  /** Select what `ref` names and aim the camera at it: the one place a ref
   *  becomes a focus. False when there is nothing to look at. */
  private pointAt(ref: NodeRef, mode?: FocusMode): boolean {
    const scene = this.session.scene.peek();
    if (!scene) return false;
    const sel =
      ref === null
        ? scene.picker.selection.peek()
        : 'sha' in ref
          ? scene.picker.selectByCommit(ref.sha)
          : scene.picker.selectByPath(ref.path);
    if (!sel) return false;
    scene.rig.focusSelection(sel, mode);
    return true;
  }

  // Arrow properties throughout: these are handed to onClick and to prop
  // callbacks, where a plain method would arrive unbound.

  /** Hover-highlight the node at `path` (tree-row hover → city highlight). */
  hoverPath = (path: string): void => {
    this.session.scene.peek()?.picker.hoverByPath(path);
  };

  clearHover = (): void => {
    this.session.scene.peek()?.picker.setHover(null);
  };

  /** Clear the selection, which closes the contextual right sidebar. */
  clearSelection = (): void => {
    this.session.scene.peek()?.picker.clearSelection();
  };

  /** Focus a node, selecting it first if it isn't: an almanac row is a Focus
   *  button for something you haven't picked yet. Re-selecting is identity. */
  focusPath = (path: string, mode?: FocusMode): void => {
    if (this.pointAt({ path }, mode)) revealCity();
  };

  focusCommit = (sha: string, mode?: FocusMode): void => {
    if (this.pointAt({ sha }, mode)) revealCity();
  };

  /** Focus whatever is selected, whichever kind: a keystroke and a Focus
   *  button are the same request. */
  focusSelection = (mode?: FocusMode): void => {
    if (this.pointAt(null, mode)) revealCity();
  };

  /** Go to a node named in a list. The details open, unlike the Focus commands:
   *  there you act on what's in front of you, here you asked for the name. */
  goToPath = (path: string, mode?: FocusMode): void => {
    if (this.pointAt({ path }, mode)) revealDetails();
  };

  goToCommit = (sha: string, mode?: FocusMode): void => {
    if (this.pointAt({ sha }, mode)) revealDetails();
  };

  /** A commit's details with the camera left alone: the timeline's own row,
   *  where you are already looking at what you asked about. */
  showCommit = (sha: string): void => {
    const scene = this.session.scene.peek();
    if (!scene) return;
    scene.picker.selectByCommit(sha);
    openSelectionPane();
  };

  /** Reset the camera framing to the current mode's default pose. */
  resetView = (): void => {
    this.session.scene.peek()?.rig.reset();
  };

  /** Debug: the building/street collision check. */
  runCollisionCheck = (): void => {
    this.session.scene.peek()?.world.runCollisionCheck();
  };

  /** Debug: the stem-placement diagnostic. */
  runStemDiagnostic = (): void => {
    this.session.scene.peek()?.world.runStemPlacementDiagnostic();
  };

  /** Debug: audit every tree's contact with the ground. */
  runTreeGroundingCheck = (): void => {
    this.session.scene.peek()?.world.runTreeGroundingDiagnostic();
  };
}
