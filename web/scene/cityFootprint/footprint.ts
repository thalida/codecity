// scene/cityFootprint/footprint.ts — Cyberpunk Valley city footprint.
//
// One InstancedMesh of axis-aligned quads on the XZ plane, one
// instance per (building | street | path) rect from the CityLayout.
// Each instance is the rect inflated by FOOTPRINT.HALO_WIDTH in both
// axes. Coplanar overlaps with depthWrite: false compose visually
// into one continuous asphalt slab — no CSG, no triangulation, no
// explicit contour computation.
//
// Lifecycle matches createValleyFloor / createParks:
//
//   const fp = createCityFootprint(layout);
//   scene.add(fp.group);
//   fp.refresh();   // on applyTheme() — color + visibility
//   fp.dispose();   // on rebuild / scene teardown
//
// Structural changes (HALO_WIDTH) trigger a rebuild via hotReload.ts;
// refresh() handles COLOR + ENABLED only.

import * as THREE from 'three';
import { FOOTPRINT } from '@/config/footprint.js';
import { RENDER_ORDERS } from '@/constants';
import { StreetAxis } from '@/types';
import type { Building, BuildingPath, CityLayout, Street } from '@/types';

export interface CityFootprint {
  group: THREE.Group;
  refresh(): void;
  dispose(): void;
}

interface Rect {
  cx: number; cz: number; w: number; d: number;
}

function rectOfBuilding(b: Building): Rect {
  return { cx: b.x, cz: b.y, w: b.w, d: b.d };
}

function rectOfPath(p: BuildingPath): Rect {
  return { cx: p.x, cz: p.y, w: p.w, d: p.d };
}

function rectOfStreet(s: Street): Rect {
  if (s.orientation === StreetAxis.X) {
    return { cx: s.x, cz: s.y, w: s.length, d: s.width };
  }
  return { cx: s.x, cz: s.y, w: s.width, d: s.length };
}

function setColorFromHex(target: THREE.Color, hex: string): void {
  target.setStyle(hex, THREE.LinearSRGBColorSpace);
}

export function createCityFootprint(layout: CityLayout): CityFootprint {
  const cfg = FOOTPRINT.get();
  const halo = Math.max(0, cfg.HALO_WIDTH);

  const rects: Rect[] = [];
  for (const b of layout.buildings) rects.push(rectOfBuilding(b));
  for (const s of layout.streets) rects.push(rectOfStreet(s));
  for (const p of layout.paths) rects.push(rectOfPath(p));

  const geometry = new THREE.PlaneGeometry(1, 1);
  geometry.rotateX(-Math.PI / 2);

  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    toneMapped: false,
    depthWrite: false,
  });
  setColorFromHex(material.color, cfg.COLOR);

  const mesh = new THREE.InstancedMesh(geometry, material, rects.length);
  mesh.name = 'city-footprint';
  mesh.renderOrder = RENDER_ORDERS.CITY_FOOTPRINT;
  mesh.frustumCulled = false;

  const tmpMatrix = new THREE.Matrix4();
  const tmpV3a = new THREE.Vector3();
  const tmpV3b = new THREE.Vector3();
  const tmpQ = new THREE.Quaternion();

  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    tmpV3a.set(r.cx, 0, r.cz);
    tmpV3b.set(r.w + halo * 2, 1, r.d + halo * 2);
    tmpMatrix.compose(tmpV3a, tmpQ, tmpV3b);
    mesh.setMatrixAt(i, tmpMatrix);
  }
  mesh.instanceMatrix.needsUpdate = true;

  const group = new THREE.Group();
  group.name = 'city-footprint';
  group.userData.cyberpunkValley = 'cityFootprint';
  group.visible = cfg.ENABLED;
  group.add(mesh);

  function refresh(): void {
    const c = FOOTPRINT.get();
    setColorFromHex(material.color, c.COLOR);
    group.visible = c.ENABLED;
  }

  function dispose(): void {
    if (group.parent) group.parent.remove(group);
    geometry.dispose();
    material.dispose();
  }

  return { group, refresh, dispose };
}
