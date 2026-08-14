// city/layout/protocol.ts — the layout-worker message contract. The single
// source for LayoutRequest + LayoutResponse, imported by both sides (worker.ts
// posts/receives them; index.ts builds the request + narrows the response) so
// the two ends can never drift. Mirrors components/trees/treePlacementProtocol.ts.

import type { StreetLayoutConfig, StreetTier } from '@/state/stores/settings/streets';
import type { BuildingDimensionsConfig } from '@/state/stores/settings/buildings';
import type { GemSizingConfig } from '@/state/stores/settings/gem';
import type { Manifest, CityLayout } from '@/types';

/** The only manifest slice the layout worker needs. layoutCity reads just
 *  `tree` + `stats`; sending the full Manifest structured-clones the entire
 *  commits array (up to ~1M entries) across the postMessage boundary on the
 *  main thread every apply, for nothing — see createLayoutClient.compute. */
export type LayoutManifest = Pick<Manifest, 'tree' | 'stats'>;

export interface LayoutRequest {
  type: 'layout';
  id: number;
  manifest: LayoutManifest;
  configSnapshot: {
    streetLayout: StreetLayoutConfig;
    buildingDimensions: BuildingDimensionsConfig;
    gemSizing: GemSizingConfig;
    streetTiers: StreetTier[];
  };
}

export type LayoutResponse =
  | { type: 'layout-result'; id: number; layout: CityLayout }
  | { type: 'layout-error'; id: number; message: string }
  // Sent mid-pack, at most once per whole percent (see createPackReporter):
  // the longest stretch of a build, and the only one that can measure itself.
  | { type: 'layout-progress'; id: number; percent: number };
