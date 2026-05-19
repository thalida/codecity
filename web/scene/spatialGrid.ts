// scene/spatialGrid.ts — Maps the layout world plane (XZ) onto a
// fixed-cell-size 2D grid. Cells are the rendering primitive: each
// owns a detail InstancedMesh, impostor InstancedMesh, label
// InstancedMesh, and merged sidewalk geometry. Grid math is pure:
// worldToCell, cellBoundsSphere, cellCenter.
//
// CELL_SIZE is chosen so that, at typical camera zoom, a cell
// covers a recognizable patch of the city — ~12 world units. Grid
// dimensions derive from layout bounds, not file count, so mesh
// count stays bounded as repos scale.

import * as THREE from 'three';

export const CELL_SIZE = 12;

export interface WorldBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface CellCoord {
  cx: number;
  cz: number;
  cellId: number;
}

export class SpatialGrid {
  readonly bounds: WorldBounds;
  readonly gridW: number;
  readonly gridH: number;
  readonly cellCount: number;

  constructor(bounds: WorldBounds) {
    const w = Math.max(1, bounds.maxX - bounds.minX);
    const h = Math.max(1, bounds.maxZ - bounds.minZ);
    this.bounds = bounds;
    this.gridW = Math.max(1, Math.ceil(w / CELL_SIZE));
    this.gridH = Math.max(1, Math.ceil(h / CELL_SIZE));
    this.cellCount = this.gridW * this.gridH;
  }

  worldToCell(x: number, z: number): CellCoord {
    const lx = x - this.bounds.minX;
    const lz = z - this.bounds.minZ;
    const cx = Math.min(this.gridW - 1, Math.max(0, Math.floor(lx / CELL_SIZE)));
    const cz = Math.min(this.gridH - 1, Math.max(0, Math.floor(lz / CELL_SIZE)));
    return { cx, cz, cellId: cz * this.gridW + cx };
  }

  cellCenter(cellId: number): THREE.Vector3 {
    const cx = cellId % this.gridW;
    const cz = Math.floor(cellId / this.gridW);
    return new THREE.Vector3(
      this.bounds.minX + (cx + 0.5) * CELL_SIZE,
      0,
      this.bounds.minZ + (cz + 0.5) * CELL_SIZE,
    );
  }

  /**
   * Bounding sphere over the cell footprint, with a fixed vertical
   * extent to cover the tallest expected building. Diagonal of the
   * XZ footprint is the lower bound on radius.
   */
  cellBoundsSphere(cellId: number, maxBuildingHeight = 20): THREE.Sphere {
    const center = this.cellCenter(cellId);
    center.y = maxBuildingHeight / 2;
    const halfDiag = Math.sqrt(
      (CELL_SIZE / 2) ** 2 * 2 + (maxBuildingHeight / 2) ** 2,
    );
    return new THREE.Sphere(center, halfDiag);
  }
}
