// city/components/trees/treePlacementWorker.ts — the worker end of tree
// placement: a slim layout plus a config snapshot in, TreePlacement[] out.
// Pure compute, no DOM and no three.js.
import { placeTrees, type TreePlacement, type LayoutGeometry } from './treePlacement';
import type { TreesConfig } from '@/city/session/settings/trees';
import type { FootprintConfig } from '@/city/session/settings/footprint';
import type { WorldConfig } from '@/city/session/settings/island';
import type { IslandConfig } from '@/city/session/settings/island';
import type { CityBbox } from '@/city/scene/types';

type TreesValue = TreesConfig;
type FootprintValue = FootprintConfig;
type WorldValue = WorldConfig;

import { MSG } from './treePlacementProtocol';

interface PlaceRequest {
  type: typeof MSG.REQUEST;
  id: number;
  layout: LayoutGeometry;
  bbox: CityBbox | undefined;
  commitCount: number;
  cityHeight: number;
  configSnapshot: {
    trees: TreesValue;
    footprint: FootprintValue;
    /** Island geometry config snapshot — used to rebuild the island polygon
     *  inside the worker without touching main-thread stores. */
    islandGeo: IslandConfig;
    /** A worker has its own store state, so without this snapshot
     *  GROUND_BUFFER_PERCENT stays at the worker's default. */
    world: WorldValue;
  };
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
      config: {
        trees: data.configSnapshot.trees,
        footprint: data.configSnapshot.footprint,
        island: data.configSnapshot.islandGeo,
        world: data.configSnapshot.world,
      },
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
