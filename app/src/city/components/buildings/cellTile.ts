// city/components/buildings/cellTile.ts — the spatial grid's rendering
// primitive: one preallocated InstancedMesh plus its slot table, with unused
// slots held at zero scale so they don't render. Data carrier only; cellMesh.ts
// and friends do the geometry and material assembly.

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

/** Every slot starts scale-zero, and the geometry is a placeholder the
 *  cell-aware builders swap out once the cell is attached. `extent` sizes the
 *  cull sphere to what this cell will actually hold. */
export function createEmptyCellTile(
  grid: SpatialGrid,
  cellId: number,
  capacity: number,
  extent: { maxHeight: number; overhang: number } = { maxHeight: 20, overhang: 0 }
): CellTile {
  const cx = cellId % grid.gridW;
  const cz = Math.floor(cellId / grid.gridW);
  const boundsSphere = grid.cellBoundsSphere(cellId, extent.maxHeight, extent.overhang);

  // Placeholder unit-cube geometry — the cell-aware builders swap this
  // for the real shared geometry. We allocate now so capacity is known.
  const placeholderGeom = new THREE.BoxGeometry(1, 1, 1);
  const placeholderMat = new THREE.MeshBasicMaterial({ visible: false });

  const detailMesh = new THREE.InstancedMesh(placeholderGeom, placeholderMat, capacity);
  // The mesh itself never leaves the origin — buildings live in instanceMatrix —
  // so recomposing its identity matrix every frame is pure cost.
  detailMesh.matrixAutoUpdate = false;
  detailMesh.frustumCulled = true;
  // The cell's own extent, not three's: left to itself it computes a sphere from
  // the instance matrices on the first frustum test and caches it for good, so
  // every later write (a rebuild's tween, a scrub) culls against where the
  // buildings USED to be. This one is true for any arrangement inside the cell.
  detailMesh.boundingSphere = boundsSphere;
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
