// scene/cityFootprint/footprint.ts — Cyberpunk Valley city footprint.
//
// One InstancedMesh of axis-aligned quads on the XZ plane, one
// instance per (building | street | path) rect from the CityLayout.
// Each instance is the rect inflated by FOOTPRINT.HALO_WIDTH in both
// axes. Coplanar overlaps with depthWrite: false compose visually
// into one continuous asphalt slab — no CSG, no triangulation, no
// explicit contour computation.
//
// Each instance carries its inflated half-extents (in world units)
// as a vec2 per-instance attribute, and the fragment shader runs a
// rounded-rectangle SDF in world-distance-from-edge space so that
// FOOTPRINT.CORNER_RADIUS (a uniform in world units) stays a true
// world-space radius regardless of the non-uniform per-instance
// scale. Where two rects overlap heavily the rounded corner of one
// is masked by its neighbor — outer silhouette corners read as
// rounded; internal "step" corners still composite continuously.
//
// Lifecycle matches createValleyFloor / createParks:
//
//   const fp = createCityFootprint(layout);
//   scene.add(fp.group);
//   fp.refresh();   // on applyTheme() — color + radius + visibility
//   fp.dispose();   // on rebuild / scene teardown
//
// Structural changes (HALO_WIDTH) trigger a rebuild via hotReload.ts;
// refresh() handles COLOR, CORNER_RADIUS, and ENABLED only.

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

const FOOTPRINT_VERT = /* glsl */ `
attribute vec2 aHalfExtent;
varying vec2 vP;
varying vec2 vHalfExtent;
void main() {
  // The unit quad's vertex sits in [-0.5, 0.5] on x and z (PlaneGeometry
  // rotated -π/2 about X). Doubling and multiplying by the per-instance
  // half-extent gives the world-space offset from the instance center
  // in world units, which the fragment shader uses for the SDF.
  vP = position.xz * 2.0 * aHalfExtent;
  vHalfExtent = aHalfExtent;
  // instanceMatrix is auto-bound by InstancedMesh.
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}
`;

const FOOTPRINT_FRAG = /* glsl */ `
precision mediump float;
uniform vec3 uColor;
uniform float uCornerRadius;
varying vec2 vP;
varying vec2 vHalfExtent;
void main() {
  // Per-instance clamp: a radius larger than the smallest half-extent
  // would turn the rect into a pill/ellipse. Small rects (e.g. a
  // narrow building inflated by HALO_WIDTH) degrade gracefully.
  float r = min(uCornerRadius, min(vHalfExtent.x, vHalfExtent.y));
  // Inigo Quilez rounded-box SDF in world units.
  vec2 q = abs(vP) - vHalfExtent + r;
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  if (d > 0.0) discard;
  gl_FragColor = vec4(uColor, 1.0);
}
`;

export function createCityFootprint(layout: CityLayout): CityFootprint {
  const cfg = FOOTPRINT.get();
  const halo = Math.max(0, cfg.HALO_WIDTH);

  const rects: Rect[] = [];
  for (const b of layout.buildings) rects.push(rectOfBuilding(b));
  for (const s of layout.streets) rects.push(rectOfStreet(s));
  for (const p of layout.paths) rects.push(rectOfPath(p));

  const geometry = new THREE.PlaneGeometry(1, 1);
  geometry.rotateX(-Math.PI / 2);

  // Per-instance half-extents in world units, so the fragment shader
  // can SDF a rounded rectangle in world-space instead of unit-space
  // (which would distort the corner radius under non-uniform scaling).
  const halfExtents = new Float32Array(rects.length * 2);
  for (let i = 0; i < rects.length; i++) {
    halfExtents[i * 2 + 0] = (rects[i].w + halo * 2) * 0.5;
    halfExtents[i * 2 + 1] = (rects[i].d + halo * 2) * 0.5;
  }
  geometry.setAttribute(
    'aHalfExtent',
    new THREE.InstancedBufferAttribute(halfExtents, 2),
  );

  const colorUniform = new THREE.Color();
  setColorFromHex(colorUniform, cfg.COLOR);

  const material = new THREE.ShaderMaterial({
    vertexShader: FOOTPRINT_VERT,
    fragmentShader: FOOTPRINT_FRAG,
    depthWrite: false,
    uniforms: {
      uColor: { value: colorUniform },
      // CORNER_RADIUS is a fraction of HALO_WIDTH (0 → sharp, 1 → one
      // halo width, 2 → two). Compute world-units radius here so the
      // shader's SDF can keep using a single uniform.
      uCornerRadius: { value: Math.max(0, cfg.CORNER_RADIUS) * halo },
    },
  });

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
    setColorFromHex(material.uniforms.uColor.value as THREE.Color, c.COLOR);
    material.uniforms.uCornerRadius.value =
      Math.max(0, c.CORNER_RADIUS) * Math.max(0, c.HALO_WIDTH);
    group.visible = c.ENABLED;
  }

  function dispose(): void {
    if (group.parent) group.parent.remove(group);
    geometry.dispose();
    material.dispose();
  }

  return { group, refresh, dispose };
}
