// types/building.ts — pairs with config/building.ts (the tunables).
// Defines the Building shape the layout step produces; engine.ts reads
// it to instantiate three.js meshes.

import type { FileNode, DirNode } from './manifest';

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
  /**
   * 0..1 weathering signal — 0 = file created most recently in the repo,
   * 1 = file created earliest. Normalized against the repo's
   * createdMin/createdMax so the scale rescales as the codebase ages.
   * Independent of `color` (which keys on last-modified): a bright,
   * recently-edited file can still be highly weathered if it was
   * originally created long ago.
   *
   * Optional because layout produces buildings without it; the
   * world post-layout step fills it in after the manifest's
   * date ranges are known. Buffer-builder defaults to 0 when absent.
   */
  createdAge?: number;

  /**
   * 0..1 staleness signal — 0 = file modified most recently in the repo,
   * 1 = file modified earliest. Normalized against the repo's
   * modifiedMin/modifiedMax so the scale rescales as the codebase ages.
   * Mirror of `createdAge` but on the modified-date axis.
   *
   * Optional because layout produces buildings without it; the
   * world post-layout step fills it in after the manifest's
   * date ranges are known. Buffer-builder defaults to 0 when absent.
   */
  modifiedAge?: number;
  file: FileNode;
  orient: BuildingOrient;
  floors?: number;

  /**
   * Cell ID for spatial grid bucketing. Set by CellTile insertion.
   * Used by BuildingIndex for reverse lookup (raycaster hit → building).
   */
  cellId?: number;

  /**
   * Slot ID within a cell's InstancedMesh. Set by CellTile insertion.
   * Combined with cellId as "cellId:slotId" key for byCellSlot index.
   */
  slotId?: number;

  /**
   * Parent directory node. Set during manifest processing.
   * Used by BuildingIndex for dir-walk queries (forEachInDir).
   */
  dirNode?: DirNode;
}
