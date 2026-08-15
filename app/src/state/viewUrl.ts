// state/viewUrl.ts — mode, scrub position and selection ⇄ the page URL. They
// span three stores, so this reflection lives in none of them. replaceState
// only, off the SETTLED scrub position: a drag would otherwise bury the user's
// own history. Restoring waits for a city — the boot load resolves before one.

import { signal, effect, type Signal } from '@preact/signals';

import { VIEW_PARAMS, TIMELINE_MODE_PARAM, SELECTION_KIND_PARAMS } from '@/constants/urlParams';
import { setRouteParams, type NavigateOptions } from '@/state/route';
import { readBootView, type BootView } from '@/state/bootView';
import { CURRENT_SOURCE } from '@/state/stores/source';
import { BUILT_MANIFEST } from '@/state/stores/manifest';
import { showPath, showCommit } from '@/state/stores/scene';
import {
  TIMELINE_MODE,
  TIMELINE_BUNDLE,
  SETTLED_COMMIT,
  SETTLED_POS,
  SCRUB_MAX,
} from '@/state/stores/timeline';
import { PICKER_SELECTION_KEY } from '@/city/interaction/picker';
import { sameSourceIdentity } from '@/utils/sources';
import { isEmptyManifest } from '@/utils/manifest';
import { NodeKind } from '@/types';
import type { PickerSelectionKey } from '@/types';

const REPLACE: NavigateOptions = { replace: true };

// ── Encoding ─────────────────────────────────────────────────────────

function selectionParam(key: PickerSelectionKey | null): string | null {
  if (!key) return null;
  const kind = SELECTION_KIND_PARAMS[key.kind];
  return key.kind === NodeKind.Commit ? `${kind}:${key.sha}` : `${kind}:${key.path}`;
}

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

// ── Restore ──────────────────────────────────────────────────────────

// ?mode and ?commit are the boot load's inputs, so only the selection is left.
// Every kind restores alike: picked out, details open, camera untouched.
function restoreSelection(selection: PickerSelectionKey): void {
  if (selection.kind === NodeKind.Commit) showCommit(selection.sha);
  else showPath(selection.path);
}

function installRestore(boot: BootView, restored: Signal<boolean>): () => void {
  // Nothing saved, or no source for it to belong to: the reflection below owns
  // the URL from its first write.
  if (!boot.src || !boot.selection) {
    restored.value = true;
    return () => {};
  }

  let claimed = false;
  return effect(() => {
    const source = CURRENT_SOURCE.value;
    // A built city for a committed source: there is something to select in.
    if (claimed || !source || isEmptyManifest(BUILT_MANIFEST.value)) return;
    claimed = true;
    // A different repo got here first (a deep link that failed, then a hand
    // pick): the saved view described the URL's repo, so let it go.
    if (!sameSourceIdentity(source, boot)) {
      restored.value = true;
      return;
    }
    // Out of the effect's tracking scope before touching any signal: the entry
    // path writes several, and a write inside the scope is a cycle.
    queueMicrotask(() => {
      if (boot.selection) restoreSelection(boot.selection);
      restored.value = true;
    });
  });
}

/** Mount the URL⇄view reactions, boot view read first so the reflection can
 *  never overwrite what it is about to restore. Returns a dispose. */
export function attachViewUrlReactions(): () => void {
  const boot = readBootView();
  const restored = signal(false);
  const stopRestore = installRestore(boot, restored);
  const stopReflect = effect(() => {
    // Like the ?src reflection: an unloaded page has no view to describe.
    if (!CURRENT_SOURCE.value || !restored.value) return;
    reflectViewToUrl();
  });
  return () => {
    stopRestore();
    stopReflect();
  };
}
