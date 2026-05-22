// scene/parks/parks.ts — Cyberpunk Valley parks renderer entry. Thin
// pass-through from a precomputed ParkPlacement[] (produced by the
// parksPlacementClient on the main thread or via the worker) to a
// Parks lifecycle handle. The placement scan is no longer invoked
// here so the renderer factory stays synchronous and the worker
// boundary lives one layer up in cityScene.
//
// Lifecycle (matches createSky):
//
//   const placements = await placementClient.compute(layout, bbox);
//   const parks = createParks(placements);
//   scene.add(parks.group);
//   parks.refresh();   // on applyTheme() hot-reload
//   parks.dispose();   // on rebuild / scene teardown

import { createParksRenderer, type Parks } from './parksRenderer.js';
import type { ParkPlacement } from './parksPlacement.js';

export function createParks(placements: ParkPlacement[]): Parks {
  return createParksRenderer(placements);
}

export type { Parks };
