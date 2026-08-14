// state/viewUrl.ts — mode, scrub position and selection ⇄ the page URL. They
// span three stores, so this reflection lives in none of them. replaceState
// only, off the SETTLED scrub position: a drag would otherwise bury the user's
// own history. Restoring waits for a city — the boot load resolves before one.

import { signal, effect, type Signal } from '@preact/signals';

import { VIEW_PARAMS, URL_PARAMS } from '@/constants/urlParams';
import { CURRENT_SOURCE } from '@/state/stores/source';
import { MANIFEST, REBUILD_STATUS, RebuildStatus } from '@/state/stores/manifest';
import { goToPath, goToCommit } from '@/state/stores/scene';
import {
  TIMELINE_MODE,
  TIMELINE_BUNDLE,
  SETTLED_COMMIT,
  SETTLED_POS,
  SCRUB_MAX,
} from '@/state/stores/timeline';
import { PICKER_SELECTION_KEY } from '@/city/interaction/picker';
import { loadTimelineScene, viewCommitInTimeline } from '@/hooks/useTimelineMode';
import { identityBranch, sameSourceIdentity } from '@/utils/sources';
import { isEmptyManifest } from '@/utils/manifest';
import { NodeKind } from '@/types';
import type { PickerSelectionKey } from '@/types';

/** ?mode's only written value: Live is the absence of the param. */
const TIMELINE_MODE_PARAM = 'timeline';

// ?sel's kind tokens: their own vocabulary, so renaming a NodeKind can't
// change what a link someone is already holding means.
const SELECTION_KIND_PARAMS = {
  [NodeKind.File]: 'file',
  [NodeKind.Directory]: 'dir',
  [NodeKind.Commit]: 'commit',
} as const;

/** The view the page was opened with. `src` is what it belongs to, not
 *  something to restore. */
interface BootView {
  src: string | null;
  branch: string | undefined;
  timeline: boolean;
  commit: string | null;
  selection: PickerSelectionKey | null;
}

// ── Encoding ─────────────────────────────────────────────────────────

function selectionParam(key: PickerSelectionKey | null): string | null {
  if (!key) return null;
  const kind = SELECTION_KIND_PARAMS[key.kind];
  return key.kind === NodeKind.Commit ? `${kind}:${key.sha}` : `${kind}:${key.path}`;
}

function parseSelection(raw: string | null): PickerSelectionKey | null {
  if (!raw) return null;
  const split = raw.indexOf(':');
  if (split <= 0) return null;
  const kind = raw.slice(0, split);
  const value = raw.slice(split + 1);
  if (!value) return null;
  if (kind === SELECTION_KIND_PARAMS[NodeKind.File]) return { kind: NodeKind.File, path: value };
  if (kind === SELECTION_KIND_PARAMS[NodeKind.Directory]) {
    return { kind: NodeKind.Directory, path: value };
  }
  if (kind === SELECTION_KIND_PARAMS[NodeKind.Commit]) return { kind: NodeKind.Commit, sha: value };
  return null;
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
  const url = new URL(window.location.href);
  setOrDelete(url.searchParams, VIEW_PARAMS.MODE, timeline ? TIMELINE_MODE_PARAM : null);
  // A scrub position only means something in Timeline: back in Live you are at
  // HEAD, so the commit leaves with the mode.
  setOrDelete(url.searchParams, VIEW_PARAMS.COMMIT, timeline ? settledCommitSha() : null);
  setOrDelete(url.searchParams, VIEW_PARAMS.SELECTION, selectionParam(PICKER_SELECTION_KEY.value));
  const next = url.toString();
  if (next !== window.location.href) history.replaceState(null, '', next);
}

// ── Restore ──────────────────────────────────────────────────────────

function readBootView(): BootView {
  const params = new URLSearchParams(window.location.search);
  const src = params.get(URL_PARAMS.SRC);
  return {
    src,
    // Normalized the way the fetch layer commits it, or a local source opened
    // with a stale ?branch would never match the source that loaded.
    branch: src ? identityBranch(src, params.get(URL_PARAMS.BRANCH) ?? undefined) : undefined,
    timeline: params.get(VIEW_PARAMS.MODE) === TIMELINE_MODE_PARAM,
    commit: params.get(VIEW_PARAMS.COMMIT),
    selection: parseSelection(params.get(VIEW_PARAMS.SELECTION)),
  };
}

/** Whether a built city is on screen. Decorating counts: the city is drawn and
 *  only its deferred pass (trees) is still in flight. */
function cityOnScreen(status: RebuildStatus): boolean {
  return status === RebuildStatus.Idle || status === RebuildStatus.Decorating;
}

async function applyBootView(boot: BootView): Promise<void> {
  if (boot.timeline) {
    // "Enter Timeline if it isn't on, then scrub there" — and a sha this repo
    // doesn't have leaves you in Timeline at the present, not on an error.
    if (boot.commit) await viewCommitInTimeline(boot.commit);
    else await loadTimelineScene();
  }
  // After the entry, always: it repacks the city, and a selection resolved
  // against the live one would be framed before the union city replaced it.
  const selection = boot.selection;
  if (!selection) return;
  // Both no-op on a path/sha this repo doesn't have.
  if (selection.kind === NodeKind.Commit) goToCommit(selection.sha);
  else goToPath(selection.path);
}

function installRestore(boot: BootView, restored: Signal<boolean>): () => void {
  // Nothing saved, or no source for it to belong to: the reflection below owns
  // the URL from its first write.
  if (!boot.src || (!boot.timeline && !boot.selection)) {
    restored.value = true;
    return () => {};
  }

  let claimed = false;
  // Idle alone is not a city to restore into: the empty boot city settles into
  // it before any source lands. Only an apply we watched start counts.
  let rebuilding = false;
  return effect(() => {
    const source = CURRENT_SOURCE.value;
    const manifest = MANIFEST.value;
    const status = REBUILD_STATUS.value;
    if (claimed) return;
    if (!source || isEmptyManifest(manifest)) return;
    if (status === RebuildStatus.Rebuilding) {
      rebuilding = true;
      return;
    }
    if (!rebuilding || !cityOnScreen(status)) return;
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
      void applyBootView(boot).finally(() => {
        restored.value = true;
      });
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
