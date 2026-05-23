// scene/parks/valleyFloor.ts — The "world floor" mesh.
//
// A large flat PlaneGeometry at y=−0.5, tinted to a forest tone,
// anchored at the gem (the root-of-repo landmark). Size comes from
// worldBounds.getWorldFloorSize() so the floor stays in lockstep
// with the tree scatter region. Once trees became commit-driven the
// world has a finite extent; the floor stops "following the camera"
// and is part of that finite world.
//
// Beyond the floor edge, the sky-sphere's lower hemisphere paints
// the horizon. Camera orbits within typical viewing distances stay
// well inside the floor; flying far enough reveals the world edge.
//
// Lifecycle:
//
//   const floor = createValleyFloor(gemWorldPos);
//   scene.add(floor.mesh);
//   floor.setAnchor(gemWorldPos);  // when the layout (re)computes the gem
//   floor.refresh();   // on every applyTheme()
//   floor.dispose();   // on scene teardown

import * as THREE from 'three';
import { PARKS_PALETTE } from '@/config/parks.js';
import { getWorldFloorSize } from './worldBounds.js';
import { RENDER_ORDERS } from '@/constants';

export interface ValleyFloor {
  mesh: THREE.Mesh;
  /** Move the floor to a new world anchor — call when the gem
   *  position changes (layout rebuild). null reverts to origin. */
  setAnchor(gemWorldPos: THREE.Vector3 | null): void;
  refresh(): void;
  dispose(): void;
}

function setColorFromHex(target: THREE.Color, hex: string): void {
  target.setStyle(hex, THREE.LinearSRGBColorSpace);
}

export function createValleyFloor(gemWorldPos: THREE.Vector3 | null): ValleyFloor {
  const size = getWorldFloorSize();
  const geometry = new THREE.PlaneGeometry(size, size);
  // PlaneGeometry default normal is +Z; rotate -90° about X so the
  // plane lies flat on the XZ plane with normal +Y (facing up).
  geometry.rotateX(-Math.PI / 2);

  const palette = PARKS_PALETTE.get();
  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    toneMapped: false,
    side: THREE.DoubleSide,
    // depthWrite is OFF so the floor paints color without leaving a
    // depth value in the buffer. Everything else (street labels at
    // y=0, sidewalks at y=0, buildings above, etc.) is drawn AFTER
    // the floor (renderOrder = -500) and writes its own depth
    // freely. Without this, the floor at y=-0.5 and the labels at
    // y=0 z-fight catastrophically at far camera distances where
    // the depth buffer can't resolve a 0.5-unit gap.
    depthWrite: false,
  });
  setColorFromHex(material.color, palette.GROUND_COLOR);

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(gemWorldPos?.x ?? 0, -0.5, gemWorldPos?.z ?? 0);
  mesh.renderOrder = RENDER_ORDERS.VALLEY_FLOOR;
  mesh.frustumCulled = false;
  mesh.visible = palette.GROUND_ENABLED;
  mesh.userData.cyberpunkValley = 'valleyFloor';

  function setAnchor(g: THREE.Vector3 | null): void {
    mesh.position.x = g?.x ?? 0;
    mesh.position.z = g?.z ?? 0;
  }

  function refresh(): void {
    const pal = PARKS_PALETTE.get();
    setColorFromHex(material.color, pal.GROUND_COLOR);
    mesh.visible = pal.GROUND_ENABLED;
  }

  function dispose(): void {
    if (mesh.parent) mesh.parent.remove(mesh);
    geometry.dispose();
    material.dispose();
  }

  return { mesh, setAnchor, refresh, dispose };
}
