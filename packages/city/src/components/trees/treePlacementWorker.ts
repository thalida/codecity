// city/components/trees/treePlacementWorker.ts — the worker end of tree
// placement: a slim layout plus the sending city's settings in,
// TreePlacement[] out. Pure compute, no DOM and no three.js.
import {
  placeTrees,
  type TreePlacement,
  type TreePlacementConfig,
  type LayoutGeometry,
} from './treePlacement';
import { MSG } from './treePlacementProtocol';
import type { CityBbox } from '@/city/types/scene';

interface PlaceRequest {
  type: typeof MSG.REQUEST;
  id: number;
  layout: LayoutGeometry;
  bbox: CityBbox | undefined;
  commitCount: number;
  cityHeight: number;
  settings: TreePlacementConfig;
}

type PlaceResponse =
  | { type: typeof MSG.RESPONSE_OK; id: number; placements: TreePlacement[] }
  | { type: typeof MSG.RESPONSE_ERROR; id: number; message: string };

self.addEventListener('message', (event: MessageEvent<PlaceRequest>) => {
  const data = event.data;
  if (!data || data.type !== MSG.REQUEST) return;
  try {
    const placements = placeTrees(data.layout, data.bbox, {
      commitCount: data.commitCount,
      cityHeight: data.cityHeight,
      settings: data.settings,
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
