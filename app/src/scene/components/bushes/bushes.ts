// scene/bushes/bushes.ts — Bushes subsystem orchestrator. Thin
// pass-through from a precomputed BushPlacement[] to a Bushes
// lifecycle handle.
//
// Lifecycle:
//
//   const placements = placeBushes(layout, bbox, { cityHeight });
//   const bushes = createBushes(placements);
//   scene.add(bushes.group);
//   bushes.refresh();   // on applyTheme() — called on Save
//   bushes.dispose();   // on rebuild / scene teardown

import { createBushRenderer, type Bushes } from './bushRenderer.js';
import type { BushPlacement } from './bushPlacement.js';

export function createBushes(placements: BushPlacement[]): Bushes {
  return createBushRenderer(placements);
}

export type { Bushes };
