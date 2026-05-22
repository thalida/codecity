// scene/parks/parksPlacementWorker.ts — Web Worker entry. Receives a
// CityLayout + bbox + a snapshot of the four config stores
// placeParks() reads, populates the worker's local stores, runs the
// scan, posts back the ParkPlacement[]. Pure compute, no DOM, no
// three.js references.

import { placeParks, type ParkPlacement } from './parksPlacement.js';
import { PARKS } from '@/config/parks.js';
import { BUILDING_DIMENSIONS } from '@/config/building.js';
import { CAMERA_PERSPECTIVE } from '@/config/view.js';
import { FOOTPRINT } from '@/config/footprint.js';
import type { CityBbox, CityLayout } from '@/types';

type ParksValue = ReturnType<typeof PARKS.get>;
type BuildingDimsValue = ReturnType<typeof BUILDING_DIMENSIONS.get>;
type CameraPerspectiveValue = ReturnType<typeof CAMERA_PERSPECTIVE.get>;
type FootprintValue = ReturnType<typeof FOOTPRINT.get>;

interface PlaceRequest {
  type: 'place';
  id: number;
  layout: CityLayout;
  bbox: CityBbox | undefined;
  configSnapshot: {
    parks: ParksValue;
    buildingDims: BuildingDimsValue;
    cameraPerspective: CameraPerspectiveValue;
    footprint: FootprintValue;
  };
}

type PlaceResponse =
  | { type: 'place-result'; id: number; placements: ParkPlacement[] }
  | { type: 'place-error'; id: number; message: string };

function _applySnapshot(snap: PlaceRequest['configSnapshot']): void {
  for (const k of Object.keys(snap.parks) as Array<keyof ParksValue>) {
    PARKS.setKey(k, snap.parks[k]);
  }
  for (const k of Object.keys(snap.buildingDims) as Array<keyof BuildingDimsValue>) {
    BUILDING_DIMENSIONS.setKey(k, snap.buildingDims[k]);
  }
  for (const k of Object.keys(snap.cameraPerspective) as Array<keyof CameraPerspectiveValue>) {
    CAMERA_PERSPECTIVE.setKey(k, snap.cameraPerspective[k]);
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
    const placements = placeParks(data.layout, data.bbox);
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
