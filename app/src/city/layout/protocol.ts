// city/layout/protocol.ts — the layout-worker message contract. The single
// source for LayoutRequest + LayoutResponse, imported by both sides (worker.ts
// posts/receives them; index.ts builds the request + narrows the response) so
// the two ends can never drift. Mirrors components/trees/treePlacementProtocol.ts.

import type { StreetLayoutConfig, StreetTier } from '@/state/stores/settings/streets';
import type { BuildingDimensionsConfig } from '@/state/stores/settings/buildings';
import type { GemSizingConfig } from '@/state/stores/settings/gem';
import type { Manifest, CityLayout } from '@/types';

export interface LayoutRequest {
  type: 'layout';
  id: number;
  manifest: Manifest;
  configSnapshot: {
    streetLayout: StreetLayoutConfig;
    buildingDimensions: BuildingDimensionsConfig;
    gemSizing: GemSizingConfig;
    streetTiers: StreetTier[];
  };
}

export type LayoutResponse =
  | { type: 'layout-result'; id: number; layout: CityLayout }
  | { type: 'layout-error'; id: number; message: string };
