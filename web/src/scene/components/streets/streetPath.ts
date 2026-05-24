// streetPath.ts — Thin sidewalk-colored strip connecting a building's
// door to the adjacent street. Sits between the sidewalk and asphalt
// layers via polygonOffset so it doesn't z-fight at intersections with
// either. Drawn at the same world Y as sidewalks, just with a higher
// renderOrder so the path stripe always wins over the surrounding
// sidewalk where they overlap.

import * as THREE from 'three';
import { SIDEWALK_COLORS } from '@/config/index.js';
import { RENDER_ORDERS } from '@/constants';
import type { BuildingPath } from '@/types';
import { flatGroundMaterial } from './streets.js';

export function createPathMesh(
  path: BuildingPath,
  yBase: number,
): THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> {
  // Paths sit between sidewalks and asphalts so they extend the sidewalk
  // all the way to the building without overdrawing the asphalt.
  const pathOrder = RENDER_ORDERS.PATH_CONNECTOR;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(path.w, path.d),
    flatGroundMaterial(SIDEWALK_COLORS.get().DEFAULT, pathOrder),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(path.x, yBase, path.y);
  mesh.renderOrder = pathOrder;
  mesh.userData.file = path.file || null;
  return mesh;
}
