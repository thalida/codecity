// scene/parks/valleyFloor.ts — The "world floor" mesh.
//
// A large flat PlaneGeometry at y=0, tinted to a forest tone, that
// follows the camera each frame. Because the plane is bigger than
// the camera's FAR clip and follows the camera, the camera ALWAYS
// sees the floor stretching to the horizon in every direction. The
// sky icosphere's lower-hemisphere fill (uGroundColor) sits behind
// the floor; for a seamless horizon they share the same color.
//
// Without this mesh the user can see the sky-sphere's "fake ground"
// in any direction where there are no buildings or trees, which
// reads as "empty plane stretching to horizon" — exactly the issue
// the parks layer alone couldn't fix (parks are discrete instances
// that can't fill arbitrary distances).
//
// Lifecycle (matches createSky):
//
//   const floor = createValleyFloor();
//   scene.add(floor.mesh);
//   floor.refresh();   // on every applyTheme()
//   floor.dispose();   // on scene teardown
//
// Camera-follow is handled at the call site (main.ts) by copying
// the camera's x/z into `floor.mesh.position` right before render
// (the same hook the sky uses).

import * as THREE from 'three';
import { PARKS_PALETTE } from '@/config/parks.js';
import { CAMERA_PERSPECTIVE } from '@/config/view.js';
import { RENDER_ORDERS } from '@/constants';

/** Multiplier on CAMERA_PERSPECTIVE.FAR for the floor mesh's side
 *  length. 4× FAR means each edge is 2× FAR from the center, so the
 *  visible portion (within FAR of the camera) is always entirely on
 *  the mesh even when the camera tilts to look toward the horizon. */
const FLOOR_SIZE_FAR_MULT = 4.0;

export interface ValleyFloor {
  mesh: THREE.Mesh;
  refresh(): void;
  dispose(): void;
}

function setColorFromHex(target: THREE.Color, hex: string): void {
  target.setStyle(hex, THREE.LinearSRGBColorSpace);
}

export function createValleyFloor(): ValleyFloor {
  const size = CAMERA_PERSPECTIVE.get().FAR * FLOOR_SIZE_FAR_MULT;
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
  // Sit a hair below y=0 so the city's own ground meshes (sidewalks,
  // asphalt, paths — all at y=0) win the depth test and paint on
  // top of the floor instead of z-fighting with it.
  mesh.position.y = -0.5;
  mesh.renderOrder = RENDER_ORDERS.VALLEY_FLOOR;
  // Always visible — the mesh is centered on the camera each frame,
  // so frustum culling against a moving target isn't meaningful.
  mesh.frustumCulled = false;
  mesh.visible = palette.GROUND_ENABLED;
  mesh.userData.cyberpunkValley = 'valleyFloor';

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

  return { mesh, refresh, dispose };
}
