// scene/trees/treePlacementWorker.ts — Web Worker entry for tree
// placement. Receives a CityLayout + bbox + a snapshot of the config
// stores placeTrees() reads, populates the worker's local stores,
// runs the scan, posts back the TreePlacement[]. Pure compute, no
// DOM, no three.js references.

import { placeTrees, type TreePlacement } from './treePlacement';
import { TREES, type TreesConfig } from '@/state/settings/trees';
import { BUILDING_DIMENSIONS, type BuildingDimensionsConfig } from '@/state/settings/components/buildings';
import { FOOTPRINT, type FootprintConfig } from '@/state/settings/components/footprint';
import { WORLD, type WorldConfig } from '@/state/settings/world/world';
import type { IslandGeometryConfig } from '@/state/settings/components/island';
import type { CityBbox, CityLayout } from '@/types';

type TreesValue = TreesConfig;
type BuildingDimsValue = BuildingDimensionsConfig;
type FootprintValue = FootprintConfig;
type WorldValue = WorldConfig;

import { MSG } from './treePlacementProtocol';

interface PlaceRequest {
  type: typeof MSG.REQUEST;
  id: number;
  layout: CityLayout;
  bbox: CityBbox | undefined;
  commitCount: number;
  cityHeight: number;
  configSnapshot: {
    trees: TreesValue;
    buildingDims: BuildingDimsValue;
    footprint: FootprintValue;
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
  | { type: typeof MSG.RESPONSE_OK; id: number; placements: TreePlacement[] }
  | { type: typeof MSG.RESPONSE_ERROR; id: number; message: string };

function _applySnapshot(snap: PlaceRequest['configSnapshot']): void {
  TREES.value = { ...TREES.value, ...snap.trees };
  BUILDING_DIMENSIONS.value = { ...BUILDING_DIMENSIONS.value, ...snap.buildingDims };
  FOOTPRINT.value = { ...FOOTPRINT.value, ...snap.footprint };
  WORLD.value = { ...WORLD.value, ...snap.world };
}

self.addEventListener('message', (event: MessageEvent<PlaceRequest>) => {
  const data = event.data;
  if (!data || data.type !== MSG.REQUEST) return;
  try {
    _applySnapshot(data.configSnapshot);
    const placements = placeTrees(data.layout, data.bbox, {
      commitCount: data.commitCount,
      cityHeight: data.cityHeight,
      islandGeoOverride: data.configSnapshot.islandGeo,
    });
    const reply: PlaceResponse = {
      type: MSG.RESPONSE_OK,
      id: data.id,
      placements,
    };
    (self as unknown as Worker).postMessage(reply);
  } catch (err) {
    const reply: PlaceResponse = {
      type: MSG.RESPONSE_ERROR,
      id: data.id,
      message: err instanceof Error ? err.message : String(err),
    };
    (self as unknown as Worker).postMessage(reply);
  }
});
