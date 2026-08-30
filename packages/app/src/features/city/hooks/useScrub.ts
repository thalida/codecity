// features/city/hooks/useScrub.ts — one city's scrub, as the panes need it.
// Re-renders exactly when the city says the mode, the bundle or the position
// moved. The arithmetic is the package's; this is where it meets a city.

import { useMemo } from 'preact/hooks';
import { useCity, useCityManifest, useCityTimeline } from '@codecity/city/preact';
import {
  paneManifest,
  presentPaths,
  scrubbedDirFor,
  type DirNode,
  type Manifest,
  type ScrubbedFileStats,
} from '@codecity/city';

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

/** Null before the canvas has built a city. One check at the top of a caller,
 *  rather than every member of this answering "there is no city" for itself. */
export function useScrub(): Scrub | null {
  const city = useCity();
  const live = useCityManifest();
  // Subscribed for the re-render, not for the values: the derivations below
  // read the engine itself, which holds more than the view reports.
  const view = useCityTimeline();
  const timeline = city?.timeline;

  return useMemo<Scrub | null>(
    () =>
      timeline
        ? {
            present: presentPaths(timeline),
            manifest: paneManifest(timeline, live),
            dirAt: (path) => scrubbedDirFor(timeline, path),
            statsFor: (path) => timeline.scrubbedStatsFor(path),
            blobShaFor: (path) => timeline.scrubbedBlobShaFor(path),
            noContentAt: (path) => timeline.hasNoContentAtScrub(path),
          }
        : null,
    [timeline, live, view]
  );
}
