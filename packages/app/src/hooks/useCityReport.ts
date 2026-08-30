// hooks/useCityReport.ts — this app's readout for one city.
//
// Replaces the five attach* functions and the one call that bundled them. They
// mirrored the city's own facts onto module signals; what is genuinely this
// app's — the loading overlay's rows, when the last build landed, the flash for
// a Save answered in place — is derived here from what the city reports.

import { useEffect, useMemo } from 'preact/hooks';
import { useCity, useCityStatus } from '@codecity/city/preact';
import { srcKind } from '@codecity/city';

import { attachSettingsReactions } from '@/state/settings/reactions';
import {
  createBuildReport,
  createOverlayDriver,
  PENDING_SOURCE_LABEL,
  type LoadingSource,
} from '@/state/stores/progress';
import type { UrlSource } from '@/router/useUrlSource';

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
