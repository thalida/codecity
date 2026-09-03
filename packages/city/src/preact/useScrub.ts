// preact/useScrub.ts — one city's scrub, as a pane needs it: which paths exist,
// the tree filtered to them, the numbers replayed at the position. Re-renders
// when the city says the mode, the bundle or the position moved.

import { useMemo } from 'preact/hooks';
import { useCity } from './context';
import { useCityManifest, useCityTimeline } from './hooks';
import { paneManifest, presentPaths, scrubbedDirFor } from '../timeline/scrubbed';
import type { DirNode, Manifest } from '../types/manifest';
import type { ScrubbedFileStats } from '../timeline/state';

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
