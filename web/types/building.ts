// types/building.ts — pairs with config/building.ts (the tunables).
// Defines the Building shape the layout step produces; engine.ts reads
// it to instantiate three.js meshes.

import type { FileNode } from './manifest';

/** Direction the door faces. Layout sets this; engine reads it. */
export enum BuildingOrient {
  North = 'n',
  South = 's',
  East = 'e',
  West = 'w',
}

/**
 * One building in the laid-out city.
 *   x, y  — center on the ground plane (world units, y is along the second axis)
 *   w, d  — footprint width (x-axis) and depth (z-axis)
 *   h     — height (y-axis, world coords)
 *   color — HSL string computed by colors.ts
 *   file  — the manifest file node this building represents
 *   floors — stamped during layout for label/tooltip use
 */
export interface Building {
  x: number;
  y: number;
  w: number;
  d: number;
  h: number;
  color: string;
  file: FileNode;
  orient: BuildingOrient;
  floors?: number;
}
