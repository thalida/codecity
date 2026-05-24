// scene/cellTile.ts — The rendering primitive for the spatial-grid
// model. Each CellTile owns up to three meshes (detail, label, street)
// plus a slot table. The InstancedMesh objects are preallocated to
// `capacity`; unused slots have zero-scale matrix so they don't render.
// Slot reuse is tracked via `freeSlots`.
//
// Mesh geometry/material assembly is deferred to the cell-aware
// factory modules (instanced/buildingsCell.ts, etc.). This file
// is just the data carrier and the empty constructor.

import * as THREE from 'three';
import type { Building } from '@/types/index.js';
import type { DirNode } from '@/types/manifest.js';
import type { SpatialGrid } from './spatialGrid.js';

export interface CellTile {
  cellId: number;
  cx: number;
  cz: number;
  boundsSphere: THREE.Sphere;

  capacity: number;
  used: number;
  freeSlots: number[];

  detailMesh: THREE.InstancedMesh;
  labelMesh: THREE.InstancedMesh | null;
  streetMesh: THREE.Mesh | null; // assembled separately by cellAssembly

  buildings: (Building | null)[];

  /** Set of directories that have buildings in this cell — for label rendering. */
  dirs: Set<DirNode>;
}

/**
 * Build an empty CellTile with a preallocated InstancedMesh. All
 * instance slots are scale-zero (invisible) until populated.
 *
 * Geometry/material wiring is intentionally minimal — the cell-aware
 * builders swap the placeholder geometry for the shared building
 * geometry once the cell is attached.
 */
export function createEmptyCellTile(
  grid: SpatialGrid,
  cellId: number,
  capacity: number,
): CellTile {
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
    freeSlots: [],
    detailMesh,
    labelMesh: null,
    streetMesh: null,
    buildings: new Array(capacity).fill(null),
    dirs: new Set(),
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
  if (cell.freeSlots.length > 0) return cell.freeSlots.pop()!;
  if (cell.used < cell.capacity) return cell.used++;
  return -1;
}

/** Free a slot (sets scale-zero, marks recyclable). */
export function freeSlot(cell: CellTile, slotId: number): void {
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  cell.detailMesh.setMatrixAt(slotId, zero);
  cell.detailMesh.instanceMatrix.needsUpdate = true;
  if (cell.labelMesh) {
    cell.labelMesh.setMatrixAt(slotId, zero);
    cell.labelMesh.instanceMatrix.needsUpdate = true;
  }
  cell.buildings[slotId] = null;
  cell.freeSlots.push(slotId);
}
