// scene/worldFloor.ts — The "world floor" mesh.
//
// A large flat PlaneGeometry at y=−0.5, tinted to a forest tone,
// sized to fit the city bbox plus a buffer (computed by
// worldBounds.getWorldBounds). Centered on the bbox center so the
// plane covers the whole city symmetrically.
//
// The plane rebuilds its geometry every time the bbox changes (via
// setBounds). PlaneGeometry is two triangles — recreating it is
// cheap and avoids the bookkeeping of scaling a fixed mesh.
//
// Beyond the plane edge, the sky paints the lower hemisphere with
// the sky color. At extreme camera positions the world edge is
// visible — that's intentional; the world has a finite, city-relative
// extent.
//
// Lifecycle:
//
//   const floor = createWorldFloor(null);
//   scene.add(floor.mesh);
//   floor.setBounds(getWorldBounds(bbox)); // when layout (re)computes
//   floor.refresh();   // on every applyTheme()
//   floor.dispose();   // on scene teardown

import * as THREE from 'three';
import { WORLD } from '@/config/world.js';
import { getWorldBounds, type WorldBounds } from './worldBounds.js';
import { RENDER_ORDERS } from '@/constants';

export interface WorldFloor {
  mesh: THREE.Mesh;
  /** Resize + reposition the floor to fit the given bounds. Disposes
   *  the old geometry and creates a new PlaneGeometry. */
  setBounds(bounds: WorldBounds): void;
  refresh(): void;
  dispose(): void;
}

function setColorFromHex(target: THREE.Color, hex: string): void {
  target.setStyle(hex, THREE.LinearSRGBColorSpace);
}

function makeGeometry(bounds: WorldBounds): THREE.PlaneGeometry {
  const geom = new THREE.PlaneGeometry(bounds.halfWidth * 2, bounds.halfDepth * 2);
  // PlaneGeometry default normal is +Z; rotate -90° about X so the
  // plane lies flat on the XZ plane with normal +Y (facing up).
  geom.rotateX(-Math.PI / 2);
  return geom;
}

export function createWorldFloor(initialBounds: WorldBounds | null): WorldFloor {
  const bounds = initialBounds ?? getWorldBounds(null);

  let geometry = makeGeometry(bounds);

  const world = WORLD.get();
  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    toneMapped: false,
    side: THREE.DoubleSide,
    // depthWrite is OFF so the floor paints color without leaving a
    // depth value. Everything else (sidewalks, asphalt, buildings)
    // draws after the floor (renderOrder = -500) and writes its own
    // depth freely. Without this, the floor at y=-0.5 and labels at
    // y=0 z-fight at far camera distances.
    depthWrite: false,
  });
  setColorFromHex(material.color, world.GROUND_COLOR);

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(bounds.cx, -0.5, bounds.cz);
  mesh.renderOrder = RENDER_ORDERS.VALLEY_FLOOR;
  mesh.frustumCulled = false;
  mesh.visible = world.GROUND_ENABLED;
  mesh.userData.cyberpunkValley = 'worldFloor';

  function setBounds(newBounds: WorldBounds): void {
    geometry.dispose();
    geometry = makeGeometry(newBounds);
    mesh.geometry = geometry;
    mesh.position.set(newBounds.cx, -0.5, newBounds.cz);
  }

  function refresh(): void {
    const w = WORLD.get();
    setColorFromHex(material.color, w.GROUND_COLOR);
    mesh.visible = w.GROUND_ENABLED;
  }

  function dispose(): void {
    if (mesh.parent) mesh.parent.remove(mesh);
    geometry.dispose();
    material.dispose();
  }

  return { mesh, setBounds, refresh, dispose };
}
