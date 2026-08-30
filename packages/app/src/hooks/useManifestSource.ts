// hooks/useManifestSource.ts — what is left of the fetch layer once loading is
// a prop. <City> streams, supersedes and polls; what stays here is this app's
// own: one city's scan on its stores, and the refresh a reader asks for.

import type { City } from '@codecity/city';

import { CURRENT_SOURCE, activeExcludePathsFor } from '@/state/stores/source';
import { failHostWork, LOADING_SOURCE, PENDING_SOURCE_LABEL } from '@/state/stores/progress';
import { srcKind } from '@codecity/city';

// ── Shared helpers ───────────────────────────────────────────────────

/** Put one city's scan onto this app's stores: which KIND of source is loading
 *  (a local path skips the rows a remote one runs) and what it is called. */
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
  ];
  return () => {
    for (const off of offs) off();
  };
}

// Injected, not imported (importing useTimelineMode back was a cycle); it
// registers before Timeline can turn on.
type TimelineRefresh = (
  city: City,
  opts?: { noCache?: boolean; overlay?: boolean }
) => Promise<void>;

let timelineRefresh: TimelineRefresh | null = null;

export function setTimelineRefreshHandler(fn: TimelineRefresh | null): void {
  timelineRefresh = fn;
}

// ── Commands ─────────────────────────────────────────────────────────
// The one thing a reader can ASK for that no prop expresses: it means "again".

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
