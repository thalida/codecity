// scene/trees/treePlacementWorker.ts — Web Worker entry for tree
// placement. Receives a CityLayout + bbox + a snapshot of the config
// stores placeTrees() reads, populates the worker's local stores,
// runs the scan, posts back the TreePlacement[]. Pure compute, no
// DOM, no three.js references.

import { placeTrees, type TreePlacement } from './treePlacement.js';
import { TREES } from '@/config/trees.js';
import { BUILDING_DIMENSIONS } from '@/config/building.js';
import { FOOTPRINT } from '@/config/footprint.js';
import { GEM_SIZING } from '@/config/gem.js';
import { WORLD } from '@/config/world.js';
import type { IslandGeometryConfig } from '@/config/island.js';
import type { CityBbox, CityLayout } from '@/types';

type TreesValue = ReturnType<typeof TREES.get>;
type BuildingDimsValue = ReturnType<typeof BUILDING_DIMENSIONS.get>;
type FootprintValue = ReturnType<typeof FOOTPRINT.get>;
type GemSizingValue = ReturnType<typeof GEM_SIZING.get>;
type WorldValue = ReturnType<typeof WORLD.get>;

interface PlaceRequest {
  type: 'place';
  id: number;
  layout: CityLayout;
  bbox: CityBbox | undefined;
  commitCount: number;
  cityHeight: number;
  configSnapshot: {
    trees: TreesValue;
    buildingDims: BuildingDimsValue;
    footprint: FootprintValue;
    gemSizing: GemSizingValue;
    /** Island geometry config snapshot — used to rebuild the island polygon
     *  inside the worker without touching main-thread stores. */
    islandGeo: IslandGeometryConfig;
    /** World sizing snapshot — getWorldBounds() inside placeTrees reads
     *  WORLD.GROUND_BUFFER_PERCENT, which would otherwise stay at the
     *  worker's default value (workers have their own nanostore state
     *  that doesn't sync with the main thread). */
    world: WorldValue;
  };
}

type PlaceResponse =
  | { type: 'place-result'; id: number; placements: TreePlacement[] }
  | { type: 'place-error'; id: number; message: string };

function _applySnapshot(snap: PlaceRequest['configSnapshot']): void {
  for (const k of Object.keys(snap.trees) as Array<keyof TreesValue>) {
    TREES.setKey(k, snap.trees[k]);
  }
  for (const k of Object.keys(snap.buildingDims) as Array<keyof BuildingDimsValue>) {
    BUILDING_DIMENSIONS.setKey(k, snap.buildingDims[k]);
  }
  for (const k of Object.keys(snap.footprint) as Array<keyof FootprintValue>) {
    FOOTPRINT.setKey(k, snap.footprint[k]);
  }
  for (const k of Object.keys(snap.gemSizing) as Array<keyof GemSizingValue>) {
    GEM_SIZING.setKey(k, snap.gemSizing[k]);
  }
  for (const k of Object.keys(snap.world) as Array<keyof WorldValue>) {
    WORLD.setKey(k, snap.world[k]);
  }
}

self.addEventListener('message', (event: MessageEvent<PlaceRequest>) => {
  const data = event.data;
  if (!data || data.type !== 'place') return;
  try {
    _applySnapshot(data.configSnapshot);
    const placements = placeTrees(data.layout, data.bbox, {
      commitCount: data.commitCount,
      cityHeight: data.cityHeight,
      islandGeoOverride: data.configSnapshot.islandGeo,
    });
    const reply: PlaceResponse = {
      type: 'place-result',
      id: data.id,
      placements,
    };
    (self as unknown as Worker).postMessage(reply);
  } catch (err) {
    const reply: PlaceResponse = {
      type: 'place-error',
      id: data.id,
      message: err instanceof Error ? err.message : String(err),
    };
    (self as unknown as Worker).postMessage(reply);
  }
});
