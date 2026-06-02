// scene/layout/spatialGrid.ts — Maps the layout world plane (XZ) onto a
// fixed-cell-size 2D grid. Cells are the rendering primitive: each
// owns a detail InstancedMesh, an optional label InstancedMesh, and
// merged sidewalk geometry. Grid math is pure: worldToCell,
// cellBoundsSphere, cellCenter.
//
// MIN_CELL_SIZE / CELL_SIZE: the minimum grid resolution (12 world
// units). For small repos this is also the actual cell size. For large
// repos (Linux-scale 86k×127k), computeOptimalCellSize() scales the
// cell size up so the grid stays at ~256 occupied cells regardless of
// layout extent.

import * as THREE from 'three';

/** Minimum cell size in world units. Also exported as CELL_SIZE for
 *  backward-compatibility with tests that use the constant directly. */
export const MIN_CELL_SIZE = 12;

/** Alias kept for backward compatibility. */
export const CELL_SIZE = MIN_CELL_SIZE;

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

  /**
   * Compute a cell size that targets ~`targetCells` total grid cells for
   * the given bounds. Returns at least MIN_CELL_SIZE so small repos keep
   * fine-grained grids.
   */
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

  /**
   * Bounding sphere over the cell footprint, with a fixed vertical
   * extent to cover the tallest expected building. Diagonal of the
   * XZ footprint is the lower bound on radius.
   */
  cellBoundsSphere(cellId: number, maxBuildingHeight = 20): THREE.Sphere {
    const center = this.cellCenter(cellId);
    center.y = maxBuildingHeight / 2;
    const halfDiag = Math.sqrt((this.cellSize / 2) ** 2 * 2 + (maxBuildingHeight / 2) ** 2);
    return new THREE.Sphere(center, halfDiag);
  }
}
