// city/components/buildings/spatialGrid.ts — maps the layout's XZ plane onto a
// 2D grid whose cells are the rendering primitive, each owning one InstancedMesh.
// Cell size scales with extent, so a Linux-scale repo still lands near 256 cells.

import * as THREE from 'three';

/** Minimum cell size in world units. */
export const MIN_CELL_SIZE = 12;

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
  readonly cellSize: number;
  readonly gridW: number;
  readonly gridH: number;
  readonly cellCount: number;

  constructor(bounds: WorldBounds, cellSize: number = MIN_CELL_SIZE) {
    const w = Math.max(1, bounds.maxX - bounds.minX);
    const h = Math.max(1, bounds.maxZ - bounds.minZ);
    this.bounds = bounds;
    this.cellSize = cellSize;
    this.gridW = Math.max(1, Math.ceil(w / cellSize));
    this.gridH = Math.max(1, Math.ceil(h / cellSize));
    this.cellCount = this.gridW * this.gridH;
  }

  /** A cell size targeting ~`targetCells` for these bounds, floored at
   *  MIN_CELL_SIZE so small repos keep a fine-grained grid. */
  static computeOptimalCellSize(bounds: WorldBounds, targetCells = 256): number {
    const w = Math.max(1, bounds.maxX - bounds.minX);
    const h = Math.max(1, bounds.maxZ - bounds.minZ);
    const area = w * h;
    return Math.max(MIN_CELL_SIZE, Math.sqrt(area / targetCells));
  }

  worldToCell(x: number, z: number): CellCoord {
    const lx = x - this.bounds.minX;
    const lz = z - this.bounds.minZ;
    const cx = Math.min(this.gridW - 1, Math.max(0, Math.floor(lx / this.cellSize)));
    const cz = Math.min(this.gridH - 1, Math.max(0, Math.floor(lz / this.cellSize)));
    return { cx, cz, cellId: cz * this.gridW + cx };
  }

  cellCenter(cellId: number): THREE.Vector3 {
    const cx = cellId % this.gridW;
    const cz = Math.floor(cellId / this.gridW);
    return new THREE.Vector3(
      this.bounds.minX + (cx + 0.5) * this.cellSize,
      0,
      this.bounds.minZ + (cz + 0.5) * this.cellSize
    );
  }

  /** Sphere over the cell footprint, tall enough for its tallest building.
   *  A cell holds building CENTRES, so `overhang` covers the slabs' spill. */
  cellBoundsSphere(cellId: number, maxBuildingHeight = 20, overhang = 0): THREE.Sphere {
    const center = this.cellCenter(cellId);
    center.y = maxBuildingHeight / 2;
    const half = this.cellSize / 2 + overhang;
    const halfDiag = Math.sqrt(half ** 2 * 2 + (maxBuildingHeight / 2) ** 2);
    return new THREE.Sphere(center, halfDiag);
  }
}
