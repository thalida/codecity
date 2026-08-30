// features/city/state/commands.ts — the commands this app's chrome sends a city.
//
// Thin on purpose: pointing the camera is the city's job (`city.focus`), and
// what the screen does afterwards is ours. All these add is the second half.

import type { City, FocusRef, FocusMode } from '@codecity/city';
import { useMemo } from 'preact/hooks';
import { useCity } from '@codecity/city/preact';

import { CURRENT_SOURCE } from '@/state/source';
import { activeExcludePathsFor } from '@/state/excludes';
import { failHostWork } from '@/features/city/state/readout';
import { OVERLAY_OPEN } from '@/features/city/state/modals';
import { useCityChrome, type CityChromeState } from '@/features/city/state/sidebar';

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
export function cityCommands(cityOf: () => City | null, chrome: CityChromeState): CityCommands {
  /** False before it boots, or when there is nothing there to look at — so the
   *  chrome stays put rather than clearing itself for nothing. */
  const pointAt = (ref: FocusRef, mode?: FocusMode): boolean => cityOf()?.focus(ref, mode) ?? false;

  return {
    hoverPath: (path) => cityOf()?.picker.hoverByPath(path),
    clearHover: () => cityOf()?.picker.setHover(null),
    clearSelection: () => cityOf()?.picker.clearSelection(),
    focusPath: (path, mode) => void (pointAt({ path }, mode) && chrome.revealCity()),
    focusCommit: (sha, mode) => void (pointAt({ sha }, mode) && chrome.revealCity()),
    focusSelection: (mode) => void (pointAt(null, mode) && chrome.revealCity()),
    goToPath: (path, mode) => void (pointAt({ path }, mode) && chrome.revealDetails()),
    goToCommit: (sha, mode) => void (pointAt({ sha }, mode) && chrome.revealDetails()),
  };
}

/** A commit's details, with the camera left alone: the timeline's own row,
 *  where you are already looking at what you asked about. */
export function showCommit(city: City | null, chrome: CityChromeState, sha: string): void {
  if (!city) return;
  city.picker.selectByCommit(sha);
  chrome.openDetails();
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

/** This app's commands, pointed at the city and chrome of the subtree calling.
 *  A hook because five components send them and each would otherwise repeat */
export function useCityCommands(): CityCommands {
  const city = useCity();
  const chrome = useCityChrome();
  return useMemo(() => cityCommands(() => city, chrome), [city, chrome]);
}

// ── Asking for it again ──────────────────────────────────────────────

// Injected, not imported (importing the timeline loader back was a cycle); it
// registers before Timeline can turn on.
type TimelineRefresh = (
  city: City,
  opts?: { noCache?: boolean; overlay?: boolean }
) => Promise<void>;

let timelineRefresh: TimelineRefresh | null = null;

export function setTimelineRefreshHandler(fn: TimelineRefresh | null): void {
  timelineRefresh = fn;
}

/** Re-read the source already open, in whichever mode it is being viewed:
 *  Timeline refetches its bundle in place rather than dropping to live HEAD. */
export function refreshCurrentSource(city: City | null, skipCache = false): void {
  if (!city) return;
  if (city.timeline.mode && timelineRefresh) {
    // Asked for by hand, so it gets the same stepped overlay a Live refresh
    // does: the history walk behind it runs for minutes on a big repo.
    void timelineRefresh(city, { noCache: skipCache, overlay: true });
    return;
  }
  void city.refreshSource({
    noCache: skipCache,
    excludes: () => {
      const cur = CURRENT_SOURCE.peek();
      return cur ? activeExcludePathsFor(cur.src) : undefined;
    },
    onError: (err) => failHostWork(err),
  });
}
