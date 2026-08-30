// hooks/useManifestSource.ts — what is left of the fetch layer once loading is
// a prop. <City> streams, supersedes and polls; what stays here is this app's
// own: one city's scan on its stores, and the refresh a reader asks for.

import type { City } from '@codecity/city';

import { CURRENT_SOURCE } from '@/state/source';
import { activeExcludePathsFor } from '@/state/excludes';
import { failHostWork } from '@/views/CityView/chrome';

// ── Shared helpers ───────────────────────────────────────────────────

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
