// scene/island/shadowDisc.ts — Flat radial-gradient disc below the
// island. Gives the eye a "below" reference so the island reads as
// suspended in space rather than pasted onto the sky.

import * as THREE from 'three';
import { ISLAND_ATMOSPHERE } from '@/config/island.js';
import { RENDER_ORDERS } from '@/constants';

export interface ShadowDisc {
  mesh: THREE.Mesh;
  refresh(): void;
  dispose(): void;
}

export interface ShadowDiscParams {
  islandRadius: number;
  bottomY: number;
}

// Build a radial-gradient texture once at module load.
function makeRadialGradientTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(0,0,0,1)');
  grad.addColorStop(0.6, 'rgba(0,0,0,0.5)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

let _sharedTexture: THREE.CanvasTexture | null = null;
function getSharedTexture(): THREE.CanvasTexture {
  if (!_sharedTexture) _sharedTexture = makeRadialGradientTexture();
  return _sharedTexture;
}

export function createShadowDisc(params: ShadowDiscParams): ShadowDisc {
  const atm = ISLAND_ATMOSPHERE.get();
  const radius = params.islandRadius * 1.1;
  const geom = new THREE.CircleGeometry(radius, 32);
  // CircleGeometry default normal is +Z; rotate so disc lies flat (normal +Y).
  geom.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    map: getSharedTexture(),
    transparent: true,
    depthWrite: false,
    opacity: atm.SHADOW_DISC_OPACITY,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.renderOrder = RENDER_ORDERS.VALLEY_FLOOR;
  const drop = params.islandRadius * atm.SHADOW_DROP_DISTANCE;
  mesh.position.set(0, params.bottomY - drop, 0);
  mesh.visible = atm.SHADOW_DISC_ENABLED;
  mesh.frustumCulled = false;
  mesh.userData.island = 'shadowDisc';

  function refresh(): void {
    const a = ISLAND_ATMOSPHERE.get();
    mat.opacity = a.SHADOW_DISC_OPACITY;
    const d = params.islandRadius * a.SHADOW_DROP_DISTANCE;
    mesh.position.y = params.bottomY - d;
    mesh.visible = a.SHADOW_DISC_ENABLED;
  }

  function dispose(): void {
    if (mesh.parent) mesh.parent.remove(mesh);
    geom.dispose();
    mat.dispose();
    // Do NOT dispose the shared texture — other discs may reuse it.
  }

  return { mesh, refresh, dispose };
}
