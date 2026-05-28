// scene/committerSoil/soilRenderer.ts — one InstancedMesh of flat
// CircleGeometry discs, laid horizontally on the ground at each tree
// center. Per-instance color via setColorAt. Material is alpha-blended
// (not additive) so the ring reads as a stain on the soil, not a glow.

import * as THREE from 'three';
import { RENDER_ORDERS } from '@/constants';
import { COMMITTER_SOIL } from '@/config/components/committerSoil.js';
import type { SoilPlacement } from './soilPlacement.js';

const GROUND_LIFT = 0.02; // tiny lift to avoid z-fighting with the floor

export interface SoilRenderer {
  group: THREE.Group;
  refresh(): void;
  dispose(): void;
}

export function createSoilRenderer(rings: SoilPlacement[]): SoilRenderer {
  const group = new THREE.Group();
  group.name = 'committer-soil';

  if (rings.length === 0) {
    return { group, refresh() {}, dispose() {} };
  }

  const geometry = new THREE.CircleGeometry(1.0, 32);
  // CircleGeometry faces +Z by default. Rotate -π/2 about X so it lies
  // flat (facing +Y) on the ground.
  geometry.rotateX(-Math.PI / 2);

  const cfg = COMMITTER_SOIL.get();
  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: cfg.SOIL_OPACITY,
    depthWrite: false,
    toneMapped: false,
    // Only viewable from above — the camera never goes below ground.
    side: THREE.FrontSide,
  });

  const mesh = new THREE.InstancedMesh(geometry, material, rings.length);
  mesh.name = 'committer-soil-discs';
  // Render after ground/streets, before trees/fireflies so the ring
  // sits visually under the foliage.
  mesh.renderOrder = RENDER_ORDERS.COMMITTER_SOIL;
  // Discs are flat + always near ground — culling is fine here (unlike
  // fireflies whose shader-bob shifts vertices out of the bounding
  // sphere). Default frustumCulled = true is correct.

  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  for (let i = 0; i < rings.length; i++) {
    const r = rings[i];
    dummy.position.set(r.treeX, GROUND_LIFT, r.treeZ);
    dummy.scale.setScalar(r.radius);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    color.setRGB(r.rgb[0], r.rgb[1], r.rgb[2], THREE.LinearSRGBColorSpace);
    mesh.setColorAt(i, color);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

  group.add(mesh);

  return {
    group,
    refresh() {
      const next = COMMITTER_SOIL.get();
      material.opacity = next.SOIL_OPACITY;
      // SOIL_RADIUS_MULTIPLIER changes require a placement + geometry rebuild
      // and go through the rebuild path; not handled here.
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      group.remove(mesh);
      mesh.dispose();
    },
  };
}
