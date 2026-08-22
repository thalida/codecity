// router/viewBinding.ts — mode, scrub position and selection ⇄ the page URL, a
// binding that spans three stores so it lives in none of them. The view writes
// the URL (replace only, off the SETTLED scrub position, or a drag buries your
// history), and the URL writes the view, which is what Back and Forward need.

import { signal, effect, untracked, type Signal } from '@preact/signals';

import { VIEW_PARAMS, TIMELINE_MODE_PARAM } from '@/router/params';
import { setRouteParams, ROUTE_PARAMS, ROUTE_PATH, type NavigateOptions } from './location';
import { parseSelection, selectionParam } from './viewParams';
import { ROUTES } from './paths';
import type { ProjectSession } from '@/state/project/session';
import { FocusMode } from '@/city/render/cameraRig';
import { NodeKind } from '@/types';
import type { PickerSelectionKey } from '@/types';

const REPLACE: NavigateOptions = { replace: true };

/** Bind one project's view (mode, scrubbed commit, selection) to the URL, both
 *  ways. Attached for the session the address bar describes; others are not. */
export function attachViewUrlReactions(session: ProjectSession): () => void {
  const { source, progress, timeline, commands, city } = session;

  // ── Encoding ─────────────────────────────────────────────────────────

  /** The sha the scrubber rests on, or null at the present — so a link that
   *  means "now" still means it once the branch has moved on. */
  function settledCommitSha(): string | null {
    if (timeline.settledPos.value >= timeline.scrubMax.value) return null;
    return timeline.bundle.value?.commits[timeline.settledCommit.value]?.sha ?? null;
  }

  function setOrDelete(params: URLSearchParams, key: string, value: string | null): void {
    if (value === null) params.delete(key);
    else params.set(key, value);
  }

  // ── Reflection ───────────────────────────────────────────────────────

  function reflectViewToUrl(): void {
    const scrubbing = timeline.mode.value;
    const selection = selectionParam(city.value?.picker.selectionKey.value ?? null);
    const commit = scrubbing ? settledCommitSha() : null;
    // Replace, always: none of these is a place the user asked to go, and a drag
    // would otherwise bury their own history under a hundred entries.
    setRouteParams((params) => {
      setOrDelete(params, VIEW_PARAMS.MODE, scrubbing ? TIMELINE_MODE_PARAM : null);
      // A scrub position only means something in Timeline: back in Live you are at
      // HEAD, so the commit leaves with the mode.
      setOrDelete(params, VIEW_PARAMS.COMMIT, commit);
      setOrDelete(params, VIEW_PARAMS.SELECTION, selection);
    }, REPLACE);
  }

  // ── Follow ───────────────────────────────────────────────────────────

  /** Every kind restores alike: the same go-to command a list row sends, in the
   *  focus mode that centres the node without turning the camera off its angle. */
  function applySelection(selection: PickerSelectionKey | null): void {
    if (!selection) commands.clearSelection();
    else if (selection.kind === NodeKind.Commit)
      commands.goToCommit(selection.sha, FocusMode.Recenter);
    else commands.goToPath(selection.path, FocusMode.Recenter);
  }

  /** Put the view the URL describes on screen. Reads the live view untracked and
   *  acts only on what the URL newly asks for: the reflection writes this URL. */
  function installViewFollow(followed: Signal<boolean>): () => void {
    // What the URL asked for last pass. The actions below are async, so re-acting
    // on a request already carried out re-issues it forever (see the test).
    let asked: { mode: boolean; commit: string | null; selection: string | null } | null = null;

    return effect(() => {
      const params = ROUTE_PARAMS.value;
      const onCity = ROUTE_PATH.value === ROUTES.CITY;
      const opened = source.current.value;
      const built = progress.cityOnScreen.value;
      // Nothing to select in, and no bundle to scrub, until there is a city.
      if (!onCity || !opened || !built) return;

      const wantTimeline = params.get(VIEW_PARAMS.MODE) === TIMELINE_MODE_PARAM;
      const wantCommit = params.get(VIEW_PARAMS.COMMIT);
      const wantSelection = params.get(VIEW_PARAMS.SELECTION);
      // settledCommitSha reads signals this effect's own action writes, so the
      // whole comparison is untracked: tracked, it wakes on its own work.
      const [modeOff, commitOff, selectionOff] = untracked(() => [
        wantTimeline !== timeline.mode.peek(),
        wantTimeline && !!wantCommit && wantCommit !== settledCommitSha(),
        wantSelection !== selectionParam(city.peek()?.picker.selectionKey.peek() ?? null),
      ]);

      // A dimension is acted on when the view is off it AND the URL is asking for
      // something it has not already been asked for.
      const fresh = asked;
      asked = { mode: wantTimeline, commit: wantCommit, selection: wantSelection };
      const modeDiffers = modeOff && (fresh === null || fresh.mode !== wantTimeline);
      const commitDiffers = commitOff && (fresh === null || fresh.commit !== wantCommit);
      const selectionDiffers =
        selectionOff && (fresh === null || fresh.selection !== wantSelection);

      // The common case, and the gate must open NOW rather than a microtask
      // later, or the view it protects has moved on by the time it does.
      if (!modeDiffers && !commitDiffers && !selectionDiffers) {
        followed.value = true;
        return;
      }

      // Out of the tracking scope: everything below writes signals this reads.
      queueMicrotask(() => {
        if (modeDiffers) {
          if (wantTimeline)
            void session.timelineMode.loadScene({ commit: wantCommit ?? undefined });
          else session.timelineMode.exit();
        } else if (commitDiffers && wantCommit) {
          void session.timelineMode.viewCommit(wantCommit);
        }
        if (selectionDiffers) applySelection(parseSelection(wantSelection));
        followed.value = true;
      });
    });
  }

  /** Mount the URL⇄view binding. Returns a dispose. */

  // The reflection waits for the follow's first pass, or it would describe an
  // empty view over the URL it is about to be told to restore.
  const followed = signal(false);
  const stopFollow = installViewFollow(followed);
  const stopReflect = effect(() => {
    // Like the ?src reflection: an unloaded page has no view to describe.
    if (!source.current.value || !followed.value) return;
    reflectViewToUrl();
  });
  return () => {
    stopFollow();
    stopReflect();
  };
}
