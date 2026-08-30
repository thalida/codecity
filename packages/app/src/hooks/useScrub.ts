// hooks/useScrub.ts — one city's scrub, as the panes need it.
//
// Reads the city through the package's own hooks, so it re-renders exactly
// when the city says the mode, the bundle or the position moved. Nothing here
// holds a copy of any of that: state/scrub.ts is pure arithmetic, and this is
// where it meets the city it is about.

import { useMemo } from 'preact/hooks';
import { useCity, useCityManifest, useCityTimeline } from '@codecity/city/preact';
import type { DirNode, Manifest, ScrubbedFileStats } from '@codecity/city';

import { paneManifest, presentPaths, scrubbedDirFor } from '@/state/scrub';

export interface Scrub {
  /** In Timeline, the paths that exist at the scrub. Empty in Live. */
  present: ReadonlySet<string>;
  /** What the panes render: live in Live, the filtered union in Timeline. */
  manifest: Manifest | null;
  /** A folder's measures re-added at the settled commit. Null in Live. */
  dirAt(path: string): DirNode | null;
  statsFor(path: string): ScrubbedFileStats | null;
  blobShaFor(path: string | null | undefined): string | null;
  /** A path with no content at the scrub: absent, or a ruin. */
  noContentAt(path: string | null | undefined): boolean;
}

const NOTHING: ReadonlySet<string> = new Set();

export function useScrub(): Scrub {
  const city = useCity();
  const live = useCityManifest();
  // Subscribed for the re-render, not for the values: the derivations below
  // read the engine itself, which holds more than the view reports.
  const view = useCityTimeline();
  const timeline = city?.timeline;

  return useMemo<Scrub>(
    () => ({
      present: timeline ? presentPaths(timeline) : NOTHING,
      manifest: timeline ? paneManifest(timeline, live) : live,
      dirAt: (path) => (timeline ? scrubbedDirFor(timeline, path) : null),
      statsFor: (path) => timeline?.scrubbedStatsFor(path) ?? null,
      blobShaFor: (path) => timeline?.scrubbedBlobShaFor(path) ?? null,
      noContentAt: (path) => timeline?.hasNoContentAtScrub(path) ?? false,
    }),
    [timeline, live, view]
  );
}
