// scene/trees/treePlacementWorker.ts — Web Worker entry for tree
// placement. Receives a CityLayout + bbox + a snapshot of the config
// stores placeTrees() reads, populates the worker's local stores,
// runs the scan, posts back the TreePlacement[]. Pure compute, no
// DOM, no three.js references.

import { placeTrees, type TreePlacement } from './treePlacement.js';
import { TREES } from '@/config/trees.js';
import { BUILDING_DIMENSIONS } from '@/config/building.js';
import { FOOTPRINT } from '@/config/footprint.js';
import type { CityBbox, CityLayout } from '@/types';

type TreesValue = ReturnType<typeof TREES.get>;
type BuildingDimsValue = ReturnType<typeof BUILDING_DIMENSIONS.get>;
type FootprintValue = ReturnType<typeof FOOTPRINT.get>;

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
}

self.addEventListener('message', (event: MessageEvent<PlaceRequest>) => {
  const data = event.data;
  if (!data || data.type !== 'place') return;
  try {
    _applySnapshot(data.configSnapshot);
    const placements = placeTrees(data.layout, data.bbox, {
      commitCount: data.commitCount,
      cityHeight: data.cityHeight,
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
