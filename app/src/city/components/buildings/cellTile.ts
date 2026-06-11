// city/components/buildings/cellTile.ts — The rendering primitive for the spatial-grid
// model. Each CellTile owns the detail InstancedMesh plus a slot
// table. The InstancedMesh is preallocated to `capacity`; unused
// slots have zero-scale matrix so they don't render. Slots are
// allocated sequentially up to `capacity`.
//
// Mesh geometry/material assembly is deferred to the cell-aware
// factory modules (cellMesh.ts, etc.). This file
// is just the data carrier and the empty constructor.

import * as THREE from 'three';
import type { Building } from '@/types/index';
import type { SpatialGrid } from './spatialGrid';

export interface CellTile {
  cellId: number;
  cx: number;
  cz: number;
  boundsSphere: THREE.Sphere;

  capacity: number;
  used: number;

  detailMesh: THREE.InstancedMesh;

  buildings: (Building | null)[];
}

/**
 * Build an empty CellTile with a preallocated InstancedMesh. All
 * instance slots are scale-zero (invisible) until populated.
 *
 * Geometry/material wiring is intentionally minimal — the cell-aware
 * builders swap the placeholder geometry for the shared building
 * geometry once the cell is attached.
 */
export function createEmptyCellTile(grid: SpatialGrid, cellId: number, capacity: number): CellTile {
  const cx = cellId % grid.gridW;
  const cz = Math.floor(cellId / grid.gridW);
  const boundsSphere = grid.cellBoundsSphere(cellId);

  // Placeholder unit-cube geometry — the cell-aware builders swap this
  // for the real shared geometry. We allocate now so capacity is known.
  const placeholderGeom = new THREE.BoxGeometry(1, 1, 1);
  const placeholderMat = new THREE.MeshBasicMaterial({ visible: false });

  const detailMesh = new THREE.InstancedMesh(placeholderGeom, placeholderMat, capacity);
  detailMesh.frustumCulled = true;
  detailMesh.userData = { cellId, meshKind: 'detail' };
  zeroAllInstances(detailMesh);

  return {
    cellId,
    cx,
    cz,
    boundsSphere,
    capacity,
    used: 0,
    detailMesh,
    buildings: new Array(capacity).fill(null),
  };
}

function zeroAllInstances(mesh: THREE.InstancedMesh): void {
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < mesh.count; i++) {
    mesh.setMatrixAt(i, zero);
  }
  mesh.instanceMatrix.needsUpdate = true;
}

/** Allocate the next slot in a cell. Returns -1 if at capacity. */
export function allocateSlot(cell: CellTile): number {
  return cell.used < cell.capacity ? cell.used++ : -1;
}
