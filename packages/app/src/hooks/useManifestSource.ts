// hooks/useManifestSource.ts — what is left of the fetch layer once loading is
// a prop. <City> takes `src`, `branch`, `exclude` and `watchSeconds` and does
// the streaming, superseding and polling itself; this holds the two things
// that are still this app's: putting one city's scan onto the app's own
// stores, and the refresh a reader asks for by hand.

import { ScanPhase } from '@codecity/city';
import type { City } from '@codecity/city';

import { CURRENT_SOURCE, activeExcludePathsFor } from '@/state/stores/source';
import { setManifest } from '@/state/stores/manifest';
import { failHostWork, LOADING_SOURCE, PENDING_SOURCE_LABEL } from '@/state/stores/progress';
import { TIMELINE_MODE } from '@/state/stores/timeline';
import { srcKind } from '@codecity/city';

// ── Shared helpers ───────────────────────────────────────────────────

/** Put one city's scan onto the app's own stores: which KIND of source is
 *  loading (a local path skips the rows a remote one runs), what the repo is
 *  called, and the manifest every pane reads. Not progress — the city reports
 *  that itself, as one value. Returns the unsubscribe. */
export function attachScanToStores(on: City['on']): () => void {
  const offs = [
    // The kind of source is what THIS app knows before the city reports
    // anything: a local path skips the rows a remote one runs.
    on('scan:start', ({ src, branch }) => {
      LOADING_SOURCE.value = { kind: srcKind(src), branch };
    }),
    // Server-side, so the document title and the overlay header name the
    // project the same way instead of each deriving it from the src.
    on('scan:label', ({ label }) => void (PENDING_SOURCE_LABEL.value = label)),
    on('scan:manifest', ({ manifest, phase }) => {
      // The city already applied it; this is the copy every pane reads. The
      // complete one is published by loadSource, with the source it belongs to.
      // No generation guard: a superseded load's stream is aborted by the city
      // that owns it, so nothing arrives here from a load that lost.
      if (phase === ScanPhase.PartialManifest) {
        setManifest(manifest);
      }
    }),
  ];
  return () => {
    for (const off of offs) off();
  };
}

// Injected, not imported (importing useTimelineMode back was a cycle); it
// registers before TIMELINE_MODE can turn on.
type TimelineRefresh = (opts?: { noCache?: boolean; overlay?: boolean }) => Promise<void>;

let timelineRefresh: TimelineRefresh | null = null;

export function setTimelineRefreshHandler(fn: TimelineRefresh | null): void {
  timelineRefresh = fn;
}

// ── Commands ─────────────────────────────────────────────────────────
// What is left is not a pipeline: it is the two things a reader can ASK for
// that no prop expresses, because both mean "again" rather than "instead".

/** Re-read the source already open, in whichever mode it is being viewed:
 *  Timeline refetches its bundle in place rather than dropping to live HEAD. */
export function refreshCurrentSource(city: City | null, skipCache = false): void {
  if (!city) return;
  if (TIMELINE_MODE.peek() && timelineRefresh) {
    // Asked for by hand, so it gets the same stepped overlay a Live refresh
    // does: the history walk behind it runs for minutes on a big repo.
    void timelineRefresh({ noCache: skipCache, overlay: true });
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
