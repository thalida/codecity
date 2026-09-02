// features/city/hooks/useCityReport.ts — this app's readout for one city: the loading
// overlay's rows, when the last build landed, and the flash for a Save the city
// answers in place. All of it derived from what the city reports, rather than
// copied onto module signals the way the attach* functions did.

import { useEffect, useMemo, useRef } from 'preact/hooks';
import { useCity, useCityStatus } from '@codecity/city/preact';
import { srcKind } from '@codecity/city';

import { attachSettingsReactions } from '@/features/settings/state/reactions';
import { createBuildReport } from '@/features/city/state/readout';
import { setUrlTimelineMode, clearSourceUrl, type UrlSource } from '@/router/cityUrl';
import { createOverlayDriver, type LoadingAbout } from '@/features/city/state/overlay';

export function useCityReport(source: UrlSource | null): void {
  const city = useCity();
  const status = useCityStatus();

  // One driver for one overlay: it holds which load is in flight, so a timeline
  // read's rows and a live scan's cannot open over each other.
  const drive = useMemo(
    () =>
      createOverlayDriver({
        // Nothing to fall back to: the URL describing the load goes with it.
        live: () => {
          city?.cancelLoad();
          clearSourceUrl();
        },
        // The city on screen stays; only the mode goes.
        timeline: () => {
          city?.cancelTimelineLoad();
          setUrlTimelineMode(false);
        },
      }),
    [city]
  );
  const report = useMemo(() => createBuildReport(status), [city]);

  // The server's name for the repo, mid-scan. Held, not written: the overlay
  // owns what it displays, so this is handed over with everything else.
  const label = useRef<string | null>(null);
  useEffect(() => {
    if (!city) return;
    label.current = null;
    return city.on('scan:label', (e) => void (label.current = e.label));
  }, [city]);

  // The flash for a Save the city answers by refreshing materials in place:
  // nothing rebuilds, so nothing is reported, and the Save looks ignored.
  useEffect(() => (city ? attachSettingsReactions(city) : undefined), [city]);

  // What this app knows before the city speaks. Which of the two loads is
  // running is the CITY's to say, and status says it.
  const asked: LoadingAbout | null =
    source && status.fetching
      ? {
          kind: srcKind(source.src),
          branch: source.branch,
          // Entering Timeline reads a repo already on screen; a live scan is
          // named by the server, mid-stream.
          label: city?.manifest?.tree?.name ?? label.current,
        }
      : null;
  drive(status, asked);
  report(status);
}
