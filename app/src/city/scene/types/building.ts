// types/building.ts — pairs with state/stores/settings/buildings.ts (the tunables).
// Defines the Building shape the layout step produces; the city renderer
// (city/index.ts createCityScene) reads it to instantiate three.js meshes.

import type { FileNode } from '@/types';

/** Direction the door faces. Layout sets this; engine reads it. */
export enum BuildingOrient {
  North = 'n',
  South = 's',
  East = 'e',
  West = 'w',
}

/** One building in the laid-out city. */
export interface Building {
  /** Center on the ground plane, in world units. */
  x: number;
  y: number;
  /** Footprint width (x) and depth (z), and height (y). */
  w: number;
  d: number;
  h: number;
  /** HSL, from colors.ts. Keys on last-modified, unlike createdAge below. */
  color: string;
  /** 0..1 weathering, oldest-created at 1, normalised against the repo so it
   *  rescales as the codebase ages. Filled in after layout, so optional. */
  createdAge?: number;

  /** createdAge's mirror on the modified axis: 1 is longest untouched. */
  modifiedAge?: number;
  file: FileNode;
  orient: BuildingOrient;
  floors?: number;

  /** Spatial-grid bucket, set on CellTile insertion; BuildingIndex reverses
   *  a raycaster hit back to a building through it. */
  cellId?: number;

  /** Slot within that cell's InstancedMesh; "cellId:slotId" keys the index. */
  slotId?: number;
}
