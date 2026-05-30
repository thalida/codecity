// scene/instanced/streetTile.ts — Build a single merged static
// BufferGeometry per CellTile containing all sidewalk rects whose
// centroid falls inside the cell. Replaces per-directory sidewalk
// meshes. Geometry is built once at scene construction; vertex
// colors are baked in so no per-frame uniform updates are needed.

import * as THREE from 'three';
import type { SpatialGrid } from '@/scene/layout/spatialGrid';

export interface SidewalkRect {
  x: number; // centroid X
  z: number; // centroid Z
  w: number; // width in X
  d: number; // depth in Z
  color: string; // hex
}

export function buildCellStreetMesh(
  grid: SpatialGrid,
  cellId: number,
  allRects: SidewalkRect[]
): THREE.Mesh | null {
  const cellRects = allRects.filter((r) => grid.worldToCell(r.x, r.z).cellId === cellId);
  if (cellRects.length === 0) return null;

  const positions = new Float32Array(cellRects.length * 4 * 3);
  const colors = new Float32Array(cellRects.length * 4 * 3);
  const indices = new Uint32Array(cellRects.length * 6);
  const color = new THREE.Color();

  for (let i = 0; i < cellRects.length; i++) {
    const r = cellRects[i];
    const x0 = r.x - r.w / 2,
      x1 = r.x + r.w / 2;
    const z0 = r.z - r.d / 2,
      z1 = r.z + r.d / 2;
    const Y = 0.01; // slight lift above ground plane to prevent z-fighting

    const v0 = i * 4;
    positions.set([x0, Y, z0, x1, Y, z0, x1, Y, z1, x0, Y, z1], v0 * 3);

    color.set(r.color);
    for (let k = 0; k < 4; k++) {
      colors.set([color.r, color.g, color.b], (v0 + k) * 3);
    }

    indices.set([v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3], i * 6);
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geom.setIndex(new THREE.BufferAttribute(indices, 1));
  geom.computeBoundingSphere();

  const mat = new THREE.MeshBasicMaterial({ vertexColors: true });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.userData = { cellId, meshKind: 'street' };
  return mesh;
}
