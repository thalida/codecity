// router/viewBinding.ts — mode, scrub position and selection ⇄ the page URL, a
// binding that spans three stores so it lives in none of them. The view writes
// the URL (replace only, off the SETTLED scrub position, or a drag buries your
// history), and the URL writes the view, which is what Back and Forward need.

import { signal, effect, type Signal } from '@preact/signals';

import { VIEW_PARAMS, TIMELINE_MODE_PARAM } from '@/router/params';
import { setRouteParams, ROUTE_PARAMS, ROUTE_PATH, type NavigateOptions } from './location';
import { parseSelection, selectionParam } from './viewParams';
import { ROUTES } from './paths';
import { CURRENT_SOURCE } from '@/state/stores/source';
import { BUILT_MANIFEST } from '@/state/stores/progress';
import { showPath, showCommit, clearSelection } from '@/city/sceneHandle';
import {
  TIMELINE_MODE,
  TIMELINE_BUNDLE,
  SETTLED_COMMIT,
  SETTLED_POS,
  SCRUB_MAX,
} from '@/state/stores/timeline';
import { PICKER_SELECTION_KEY } from '@/city/interaction/picker';
import { loadTimelineScene, exitTimelineMode, viewCommitInTimeline } from '@/hooks/useTimelineMode';
import { NodeKind } from '@/types';
import type { PickerSelectionKey } from '@/types';

const REPLACE: NavigateOptions = { replace: true };

// ── Encoding ─────────────────────────────────────────────────────────

/** The sha the scrubber rests on, or null at the present — so a link that
 *  means "now" still means it once the branch has moved on. */
function settledCommitSha(): string | null {
  if (SETTLED_POS.value >= SCRUB_MAX.value) return null;
  return TIMELINE_BUNDLE.value?.commits[SETTLED_COMMIT.value]?.sha ?? null;
}

function setOrDelete(params: URLSearchParams, key: string, value: string | null): void {
  if (value === null) params.delete(key);
  else params.set(key, value);
}

// ── Reflection ───────────────────────────────────────────────────────

function reflectViewToUrl(): void {
  const timeline = TIMELINE_MODE.value;
  const selection = selectionParam(PICKER_SELECTION_KEY.value);
  const commit = timeline ? settledCommitSha() : null;
  // Replace, always: none of these is a place the user asked to go, and a drag
  // would otherwise bury their own history under a hundred entries.
  setRouteParams((params) => {
    setOrDelete(params, VIEW_PARAMS.MODE, timeline ? TIMELINE_MODE_PARAM : null);
    // A scrub position only means something in Timeline: back in Live you are at
    // HEAD, so the commit leaves with the mode.
    setOrDelete(params, VIEW_PARAMS.COMMIT, commit);
    setOrDelete(params, VIEW_PARAMS.SELECTION, selection);
  }, REPLACE);
}

// ── Follow ───────────────────────────────────────────────────────────

/** Every kind restores alike: picked out, details open, camera untouched. */
function applySelection(selection: PickerSelectionKey | null): void {
  if (!selection) clearSelection();
  else if (selection.kind === NodeKind.Commit) showCommit(selection.sha);
  else showPath(selection.path);
}

/** Put the view the URL describes on screen whenever it says something the view
 *  does not. PEEKS the live view, so the reflection cannot feed back here. */
function installViewFollow(followed: Signal<boolean>): () => void {
  return effect(() => {
    const params = ROUTE_PARAMS.value;
    const onCity = ROUTE_PATH.value === ROUTES.CITY;
    const source = CURRENT_SOURCE.value;
    const built = BUILT_MANIFEST.value !== null;
    // Nothing to select in, and no bundle to scrub, until there is a city.
    if (!onCity || !source || !built) return;

    const wantTimeline = params.get(VIEW_PARAMS.MODE) === TIMELINE_MODE_PARAM;
    const wantCommit = params.get(VIEW_PARAMS.COMMIT);
    const wantSelection = params.get(VIEW_PARAMS.SELECTION);
    const modeDiffers = wantTimeline !== TIMELINE_MODE.peek();
    const commitDiffers = wantTimeline && !!wantCommit && wantCommit !== settledCommitSha();
    const selectionDiffers = wantSelection !== selectionParam(PICKER_SELECTION_KEY.peek());

    // The common case, and the gate must open NOW rather than a microtask
    // later, or the view it protects has moved on by the time it does.
    if (!modeDiffers && !commitDiffers && !selectionDiffers) {
      followed.value = true;
      return;
    }

    // Out of the tracking scope: everything below writes signals this reads.
    queueMicrotask(() => {
      if (modeDiffers) {
        if (wantTimeline) void loadTimelineScene({ commit: wantCommit ?? undefined });
        else exitTimelineMode();
      } else if (commitDiffers && wantCommit) {
        void viewCommitInTimeline(wantCommit);
      }
      if (selectionDiffers) applySelection(parseSelection(wantSelection));
      followed.value = true;
    });
  });
}

/** Mount the URL⇄view binding. Returns a dispose. */
export function attachViewUrlReactions(): () => void {
  // The reflection waits for the follow's first pass, or it would describe an
  // empty view over the URL it is about to be told to restore.
  const followed = signal(false);
  const stopFollow = installViewFollow(followed);
  const stopReflect = effect(() => {
    // Like the ?src reflection: an unloaded page has no view to describe.
    if (!CURRENT_SOURCE.value || !followed.value) return;
    reflectViewToUrl();
  });
  return () => {
    stopFollow();
    stopReflect();
  };
}
