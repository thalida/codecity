// scene/layoutWorker.ts — Web Worker entry point. Receives a manifest
// + a snapshot of the four config stores layoutCity reads, populates
// the worker's local store instances, runs the layout, posts the
// result back. Pure compute, no DOM or THREE.* references.

import { layoutCity } from './layout.js';
import {
  STREET_LAYOUT,
  BUILDING_DIMENSIONS,
  GEM_SIZING,
  STREET_TIERS,
} from '@/config/index.js';
import type { Manifest } from '@/types';
import type { CityLayout } from '@/types';

type StreetLayoutValue = ReturnType<typeof STREET_LAYOUT.get>;
type BuildingDimensionsValue = ReturnType<typeof BUILDING_DIMENSIONS.get>;
type GemSizingValue = ReturnType<typeof GEM_SIZING.get>;
type StreetTiersValue = ReturnType<typeof STREET_TIERS.get>;

interface LayoutRequest {
  type: 'layout';
  id: number;
  manifest: Manifest;
  configSnapshot: {
    streetLayout: StreetLayoutValue;
    buildingDimensions: BuildingDimensionsValue;
    gemSizing: GemSizingValue;
    streetTiers: StreetTiersValue;
  };
}

type LayoutResponse =
  | { type: 'layout-result'; id: number; layout: CityLayout }
  | { type: 'layout-error'; id: number; message: string };

function _applySnapshot(snap: LayoutRequest['configSnapshot']): void {
  // map-shaped stores get setKey for each key; atom-shaped stores get
  // a single set. STREET_TIERS is an atom (whole-array value).
  for (const k of Object.keys(snap.streetLayout) as Array<
    keyof StreetLayoutValue
  >) {
    STREET_LAYOUT.setKey(k, snap.streetLayout[k]);
  }
  for (const k of Object.keys(snap.buildingDimensions) as Array<
    keyof BuildingDimensionsValue
  >) {
    BUILDING_DIMENSIONS.setKey(k, snap.buildingDimensions[k]);
  }
  for (const k of Object.keys(snap.gemSizing) as Array<keyof GemSizingValue>) {
    GEM_SIZING.setKey(k, snap.gemSizing[k]);
  }
  STREET_TIERS.set(snap.streetTiers);
}

self.addEventListener('message', (event: MessageEvent<LayoutRequest>) => {
  const data = event.data;
  if (!data || data.type !== 'layout') return;
  try {
    _applySnapshot(data.configSnapshot);
    const layout = layoutCity(
      data.manifest as unknown as Parameters<typeof layoutCity>[0],
    );
    const reply: LayoutResponse = {
      type: 'layout-result',
      id: data.id,
      layout,
    };
    (self as unknown as Worker).postMessage(reply);
  } catch (err) {
    const reply: LayoutResponse = {
      type: 'layout-error',
      id: data.id,
      message: err instanceof Error ? err.message : String(err),
    };
    (self as unknown as Worker).postMessage(reply);
  }
});
