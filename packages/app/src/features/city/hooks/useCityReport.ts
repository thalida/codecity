// features/city/hooks/useCityReport.ts — this app's readout for one city: the loading
// overlay's rows, when the last build landed, and the flash for a Save the city
// answers in place. All of it derived from what the city reports, rather than
// copied onto module signals the way the attach* functions did.

import { useEffect, useMemo } from 'preact/hooks';
import { useCity, useCityStatus } from '@codecity/city/preact';
import { srcKind } from '@codecity/city';

import { attachSettingsReactions } from '@/features/settings/state/reactions';
import { createBuildReport } from '@/features/city/state/readout';
import {
  createOverlayDriver,
  PENDING_SOURCE_LABEL,
  type LoadingSource,
} from '@/features/city/state/overlay';
import type { UrlSource } from '@/router/cityUrl';

export function useCityReport(source: UrlSource | null): void {
  const city = useCity();
  const status = useCityStatus();

  // Both hold a little state across ticks — how far down the rows this load
  // got, whether the last status was Ready — so they are made once per city.
  const drive = useMemo(createOverlayDriver, [city]);
  const report = useMemo(() => createBuildReport(status), [city]);

  // The label arrives mid-scan, before the manifest the header reads.
  useEffect(() => {
    if (!city) return;
    return city.on('scan:label', ({ label }) => void (PENDING_SOURCE_LABEL.value = label));
  }, [city]);

  // The flash for a Save the city answers by refreshing materials in place:
  // nothing rebuilds, so nothing is reported, and the Save looks ignored.
  useEffect(() => (city ? attachSettingsReactions(city) : undefined), [city]);

  const asked: LoadingSource | null =
    source && status.fetching ? { kind: srcKind(source.src), branch: source.branch } : null;
  drive(status, asked);
  report(status);
}
