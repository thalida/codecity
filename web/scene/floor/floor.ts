// scene/floor/floor.ts — Cyberpunk Valley flat-ground-plane factory.
//
// Builds one persistent horizontal plane at world Y = FLOOR.Y_OFFSET,
// large enough to extend past the camera's typical view but small
// enough to fit inside the sky sphere (whose radius is
// CAMERA_PERSPECTIVE.FAR × 0.95). Material is a simple unlit
// MeshBasicMaterial — no shader, no lighting — because the goal is
// a clean flat color, not realism.
//
// Lifecycle (same shape as createSky()):
//
//   const floor = createFloor();
//   scene.add(floor.mesh);   // once, at cityScene boot
//   floor.refresh();         // on every applyTheme() hot-reload
//   floor.dispose();         // on cityScene teardown
//
// Render order: RENDER_ORDERS.FLOOR (-800). Drawn after the sky
// (which is at -1000) and before everything else.

import * as THREE from 'three';
import { FLOOR } from '@/config/floor.js';
import { CAMERA_PERSPECTIVE } from '@/config/view.js';
import { RENDER_ORDERS } from '@/constants';

export interface Floor {
  mesh: THREE.Mesh;
  /** Pull fresh FLOOR config values into material + transform. */
  refresh(): void;
  /** Release geometry + material GPU resources. */
  dispose(): void;
}

/**
 * setStyle(..., LinearSRGBColorSpace) skips Three's automatic
 * sRGB→linear conversion so the hex bytes go to the material
 * unchanged, matching the convention used by createSky() and the
 * building shader's sRGB-display output.
 */
function setColorFromHex(target: THREE.Color, hex: string): void {
  target.setStyle(hex, THREE.LinearSRGBColorSpace);
}

export function createFloor(): Floor {
  const cfg = FLOOR.get();

  // Size is read from CAMERA_PERSPECTIVE.FAR at build time. FAR is a
  // boot-time user config (default 20000) and only changes across
  // restarts, so the floor size doesn't need to track FAR live.
  const size = CAMERA_PERSPECTIVE.get().FAR * cfg.SIZE_MULT;

  const geometry = new THREE.PlaneGeometry(size, size);

  const material = new THREE.MeshBasicMaterial({
    color: new THREE.Color(),
    // depthWrite ON so the floor occludes anything that ends up
    // underneath it (sky bottom-hemisphere, future fly-mode below the
    // city, etc.). DoubleSide so the floor is visible from below in
    // fly mode if the user dips under.
    side: THREE.DoubleSide,
  });
  setColorFromHex(material.color, cfg.COLOR);

  const mesh = new THREE.Mesh(geometry, material);
  // -π/2 around X lays the plane flat in the XZ world plane.
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = cfg.Y_OFFSET;
  mesh.renderOrder = RENDER_ORDERS.FLOOR;
  // Floor is huge and its bounding sphere yields true from anywhere
  // the camera could reasonably be — frustum culling would always
  // pass, so skip the per-frame check entirely.
  mesh.frustumCulled = false;
  // Marked so picker / hit tests can skip it without a structural
  // check. Same convention as the sky mesh.
  mesh.userData.cyberpunkValley = 'floor';
  mesh.visible = cfg.ENABLED;

  function refresh(): void {
    const c = FLOOR.get();
    setColorFromHex(material.color, c.COLOR);
    mesh.position.y = c.Y_OFFSET;
    mesh.visible = c.ENABLED;
    // SIZE_MULT is read at construction time (we'd have to rebuild
    // the geometry to honor a live change). Leaving it unwired in
    // refresh() keeps this factory cheap and matches how sky.ts
    // treats its radius (also baked at construction).
  }

  function dispose(): void {
    if (mesh.parent) mesh.parent.remove(mesh);
    geometry.dispose();
    material.dispose();
  }

  return { mesh, refresh, dispose };
}
