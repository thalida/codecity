// scene/parks/worldBounds.ts — single source of truth for the
// rendered world's spatial extent.
//
// The world is a square plane of side WORLD_SIZE_FAR_MULT × FAR,
// centered on the gem. Both the valley floor mesh and the tree
// scatter region read these helpers so they stay in lockstep — if
// you change the multiplier, both update.
//
// Trees and the floor are world-anchored at the gem; the camera can
// fly to the edge of this region and beyond. Past the edge the
// camera sees the sky-sphere's lower hemisphere meet the floor edge
// (the "edge of the world"). This is intentional: a finite,
// commit-driven forest implies a finite world.

import { CAMERA_PERSPECTIVE } from '@/config/view.js';

/** Multiplier on CAMERA_PERSPECTIVE.FAR for the world's side length.
 *  4× = each edge sits 2× FAR from the gem, so at typical camera
 *  orbits (camera within FAR of the gem) the visible ground is
 *  entirely inside the world. */
const WORLD_SIZE_FAR_MULT = 4.0;

export function getWorldFloorSize(): number {
  return CAMERA_PERSPECTIVE.get().FAR * WORLD_SIZE_FAR_MULT;
}

export function getWorldFloorHalfSize(): number {
  return getWorldFloorSize() / 2;
}
