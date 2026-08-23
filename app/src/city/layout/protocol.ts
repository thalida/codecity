// city/layout/protocol.ts — the layout-worker message contract. The single
// source for LayoutRequest + LayoutResponse, imported by both sides (worker.ts
// posts/receives them; index.ts builds the request + narrows the response) so
// the two ends can never drift. Mirrors components/trees/treePlacementProtocol.ts.

import type { StreetLayoutConfig, StreetTier } from '@/state/settings/fields/streets';
import type { BuildingDimensionsConfig } from '@/state/settings/fields/buildings';
import type { GemSizingConfig } from '@/state/settings/fields/gem';
import type { Manifest, CityLayout } from '@/types';

/** The only slice the worker needs. Sending the whole Manifest structured-
 *  clones its commits array across postMessage every apply, for nothing. */
export type LayoutManifest = Pick<Manifest, 'tree' | 'stats'>;

/** What laying a city out reads: passed in rather than read from a store,
 *  since this runs in a worker as often as on the main thread. */
export interface LayoutConfig {
  streetLayout: StreetLayoutConfig;
  buildingDimensions: BuildingDimensionsConfig;
  gemSizing: GemSizingConfig;
  streetTiers: StreetTier[];
}

export interface LayoutRequest {
  type: 'layout';
  id: number;
  manifest: LayoutManifest;
  configSnapshot: LayoutConfig;
}

export type LayoutResponse =
  | { type: 'layout-result'; id: number; layout: CityLayout }
  | { type: 'layout-error'; id: number; message: string }
  // Sent mid-pack, at most once per whole percent (see createPackReporter):
  // the longest stretch of a build, and the only one that can measure itself.
  | { type: 'layout-progress'; id: number; percent: number };
