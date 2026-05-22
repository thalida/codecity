// scene/parks/parksRenderer.ts — turns a ParkPlacement[] (random-
// scatter individual elements) into four InstancedMeshes:
//
//   parks-tree-canopy — matte cone canopies (one per tree placement)
//   parks-tree-trunk  — small matte cylinders aligned under canopies
//   parks-bushes      — HDR-emissive icosahedra
//   parks-flowers     — additive-blended quads (one per flower)
//
// There is intentionally NO "ground" mesh — the previous design used
// per-plot square ground quads that read as squares against the dark
// floor. Foliage now sits directly on the world's ground tone.
//
// Foliage geometry is matte (no glow) for trees + trunks — per-spec
// the only sources of bloom inside the parks layer are the bushes and
// flower specks. Both run through a small custom ShaderMaterial that
// multiplies the per-instance color by a uEmissionBoost uniform, so
// the values reach the HDR bloom pass above 1.0.
//
// Per-placement jitter:
//   - Bush position is the placement center (one bush per placement).
//   - Bush's flowers are jittered into a small ring around the bush.
//   - Flower-cluster placements scatter flowers in a wider ring.
//
// `refresh()` rewrites per-instance color attributes from
// PARKS_PALETTE and updates the emission uniforms; it never rebuilds
// the InstancedMeshes. Structural changes (anything in PARKS) take
// the full rebuild path via hotReload.ts.

import * as THREE from 'three';
import { PARKS, PARKS_PALETTE } from '@/config/parks.js';
import { BUILDING_DIMENSIONS } from '@/config/building.js';
import { RENDER_ORDERS } from '@/constants';
import { pickTreeGreen, pickBushNeon, pickFlowerColor } from './parksPalette.js';
import type { ParkPlacement } from './parksPlacement.js';

export interface Parks {
  group: THREE.Group;
  refresh(): void;
  dispose(): void;
}

// ── shader sources (kept inline — short enough that a separate
//    .glsl pair would obscure rather than help) ─────────────────────

const EMISSIVE_VERT = /* glsl */ `
attribute vec3 aColor;
varying vec3 vColor;
void main() {
  vColor = aColor;
  // instanceMatrix is auto-bound by InstancedMesh.
  vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
}
`;

const EMISSIVE_FRAG = /* glsl */ `
precision mediump float;
uniform float uEmissionBoost;
varying vec3 vColor;
void main() {
  gl_FragColor = vec4(vColor * uEmissionBoost, 1.0);
}
`;

// ── small utilities ─────────────────────────────────────────────────

function knuth(seed: number): number {
  return Math.imul(seed | 0, 0x9e3779b1) >>> 0;
}

/** Unit float in [0,1) deterministic in `seed`. */
function rand01(seed: number): number {
  return knuth(seed) / 0x100000000;
}

function setColorFromHex(target: THREE.Color, hex: string): void {
  target.setStyle(hex, THREE.LinearSRGBColorSpace);
}

/**
 * Compose a per-instance matrix from translation + scale (no rotation
 * — none of the parks geometry needs it). Scratch objects are
 * caller-owned to avoid allocations in the inner loop.
 */
function setInstanceMatrix(
  mesh: THREE.InstancedMesh,
  i: number,
  x: number, y: number, z: number,
  sx: number, sy: number, sz: number,
  tmpMatrix: THREE.Matrix4,
  tmpV3a: THREE.Vector3,
  tmpV3b: THREE.Vector3,
  tmpQ: THREE.Quaternion,
): void {
  tmpV3a.set(x, y, z);
  tmpV3b.set(sx, sy, sz);
  tmpMatrix.compose(tmpV3a, tmpQ, tmpV3b);
  mesh.setMatrixAt(i, tmpMatrix);
}

// ── factory ─────────────────────────────────────────────────────────

export function createParksRenderer(placements: ParkPlacement[]): Parks {
  const cfg = PARKS.get();
  const palette = PARKS_PALETTE.get();
  const dims = BUILDING_DIMENSIONS.get();

  // Resolve relative size multipliers against BUILDING_DIMENSIONS so
  // foliage scales with the city.
  const treeHeight = cfg.TREE_HEIGHT_FLOORS * dims.FLOOR_HEIGHT;
  const treeRadius = cfg.TREE_RADIUS_FRAC_OF_HEIGHT * treeHeight;
  const bushRadius = cfg.BUSH_RADIUS_FRAC_OF_TREE * treeRadius;
  const flowerSize = cfg.FLOWER_SIZE_FRAC_OF_TREE * treeRadius;

  // Pre-sum instance counts.
  let totalTrees = 0;
  let totalBushes = 0;
  let totalFlowers = 0;
  for (const p of placements) {
    totalTrees += p.treeCount;
    totalBushes += p.bushCount;
    totalFlowers += p.flowerCount;
  }

  // ── shared materials ───────────────────────────────────────────
  const trunkMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    toneMapped: false,
  });
  setColorFromHex(trunkMaterial.color, palette.TREE_TRUNK_COLOR);

  const canopyMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff, // per-instance color via setColorAt
    toneMapped: false,
  });

  const bushMaterial = new THREE.ShaderMaterial({
    vertexShader: EMISSIVE_VERT,
    fragmentShader: EMISSIVE_FRAG,
    uniforms: {
      uEmissionBoost: { value: palette.BUSH_EMISSION_BOOST },
    },
  });

  const flowerMaterial = new THREE.ShaderMaterial({
    vertexShader: EMISSIVE_VERT,
    fragmentShader: EMISSIVE_FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    uniforms: {
      uEmissionBoost: { value: palette.FLOWER_EMISSION_BOOST },
    },
  });

  // ── geometries ─────────────────────────────────────────────────
  const canopyGeometry = new THREE.ConeGeometry(treeRadius, treeHeight, 4);
  canopyGeometry.translate(0, treeHeight / 2, 0);

  const trunkHeight = treeHeight * 0.25;
  const trunkRadius = treeRadius * 0.12;
  const trunkGeometry = new THREE.CylinderGeometry(trunkRadius, trunkRadius, trunkHeight, 4);
  trunkGeometry.translate(0, trunkHeight / 2, 0);

  const bushGeometry = new THREE.IcosahedronGeometry(bushRadius, 0);

  const flowerGeometry = new THREE.PlaneGeometry(flowerSize, flowerSize);
  flowerGeometry.rotateX(-Math.PI / 2);

  // Per-instance color buffers for the emissive (ShaderMaterial)
  // meshes. Three.js binds an InstancedBufferAttribute named `aColor`
  // to the geometry; the vertex shader reads it via `attribute vec3 aColor`.
  const bushColors = new Float32Array(totalBushes * 3);
  bushGeometry.setAttribute(
    'aColor',
    new THREE.InstancedBufferAttribute(bushColors, 3),
  );

  const flowerColors = new Float32Array(totalFlowers * 3);
  flowerGeometry.setAttribute(
    'aColor',
    new THREE.InstancedBufferAttribute(flowerColors, 3),
  );

  // ── InstancedMeshes ─────────────────────────────────────────────
  const canopyMesh = new THREE.InstancedMesh(canopyGeometry, canopyMaterial, totalTrees);
  canopyMesh.name = 'parks-tree-canopy';
  canopyMesh.renderOrder = RENDER_ORDERS.PARK_FOLIAGE;
  canopyMesh.frustumCulled = false;

  const trunkMesh = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, totalTrees);
  trunkMesh.name = 'parks-tree-trunk';
  trunkMesh.renderOrder = RENDER_ORDERS.PARK_FOLIAGE;
  trunkMesh.frustumCulled = false;

  const bushMesh = new THREE.InstancedMesh(bushGeometry, bushMaterial, totalBushes);
  bushMesh.name = 'parks-bushes';
  bushMesh.renderOrder = RENDER_ORDERS.PARK_FOLIAGE;
  bushMesh.frustumCulled = false;

  const flowerMesh = new THREE.InstancedMesh(flowerGeometry, flowerMaterial, totalFlowers);
  flowerMesh.name = 'parks-flowers';
  flowerMesh.renderOrder = RENDER_ORDERS.PARK_FOLIAGE;
  flowerMesh.frustumCulled = false;

  // ── fill instances ─────────────────────────────────────────────
  const tmpMatrix = new THREE.Matrix4();
  const tmpV3a = new THREE.Vector3();
  const tmpV3b = new THREE.Vector3();
  const tmpQ = new THREE.Quaternion(); // identity
  const tmpColor = new THREE.Color();

  let treeIdx = 0;
  let bushIdx = 0;
  let flowerIdx = 0;

  // Flowers in bush placements jitter into a tight ring around the
  // bush (~1.5× bush radius). Flowers in flower-cluster placements
  // jitter into a wider ring (~4× flower size) so clusters read as
  // patches of color rather than a single hot pixel.
  const bushFlowerRadius = bushRadius * 1.5;
  const clusterFlowerRadius = flowerSize * 8;

  for (const p of placements) {
    // Trees: canopy + trunk both sit at the placement center.
    for (let t = 0; t < p.treeCount; t++) {
      setInstanceMatrix(canopyMesh, treeIdx, p.x, trunkHeight, p.y, 1, 1, 1,
        tmpMatrix, tmpV3a, tmpV3b, tmpQ);
      setInstanceMatrix(trunkMesh, treeIdx, p.x, 0, p.y, 1, 1, 1,
        tmpMatrix, tmpV3a, tmpV3b, tmpQ);
      setColorFromHex(tmpColor, pickTreeGreen(p.seed ^ t));
      canopyMesh.setColorAt(treeIdx, tmpColor);
      treeIdx++;
    }

    // Bushes: one per placement, sitting just above ground.
    for (let b = 0; b < p.bushCount; b++) {
      setInstanceMatrix(
        bushMesh, bushIdx,
        p.x, bushRadius * 0.5, p.y,
        1, 1, 1,
        tmpMatrix, tmpV3a, tmpV3b, tmpQ,
      );
      setColorFromHex(tmpColor, pickBushNeon(p.seed ^ (b * 47 + 5)));
      bushColors[bushIdx * 3 + 0] = tmpColor.r;
      bushColors[bushIdx * 3 + 1] = tmpColor.g;
      bushColors[bushIdx * 3 + 2] = tmpColor.b;
      bushIdx++;
    }

    // Flowers: ring around the placement center. Bush placements use
    // a tight ring; flower-cluster placements use a wider one.
    const ringR = p.bushCount > 0 ? bushFlowerRadius : clusterFlowerRadius;
    for (let f = 0; f < p.flowerCount; f++) {
      const a = rand01(p.seed ^ (f * 17 + 9)) * 2 * Math.PI;
      const r = ringR * (0.3 + rand01(p.seed ^ (f * 17 + 10)) * 0.7);
      const fx = p.x + r * Math.cos(a);
      const fz = p.y + r * Math.sin(a);
      setInstanceMatrix(
        flowerMesh, flowerIdx,
        fx, flowerSize * 0.5, fz,
        1, 1, 1,
        tmpMatrix, tmpV3a, tmpV3b, tmpQ,
      );
      setColorFromHex(tmpColor, pickFlowerColor(p.seed ^ (f * 17 + 11)));
      flowerColors[flowerIdx * 3 + 0] = tmpColor.r;
      flowerColors[flowerIdx * 3 + 1] = tmpColor.g;
      flowerColors[flowerIdx * 3 + 2] = tmpColor.b;
      flowerIdx++;
    }
  }

  // Push fills to GPU.
  canopyMesh.instanceMatrix.needsUpdate = true;
  trunkMesh.instanceMatrix.needsUpdate = true;
  bushMesh.instanceMatrix.needsUpdate = true;
  flowerMesh.instanceMatrix.needsUpdate = true;
  if (canopyMesh.instanceColor) canopyMesh.instanceColor.needsUpdate = true;
  (bushGeometry.attributes.aColor as THREE.InstancedBufferAttribute).needsUpdate = true;
  (flowerGeometry.attributes.aColor as THREE.InstancedBufferAttribute).needsUpdate = true;

  // ── group ──────────────────────────────────────────────────────
  const group = new THREE.Group();
  group.name = 'parks';
  group.userData.cyberpunkValley = 'parks';
  group.visible = cfg.ENABLED;
  group.add(canopyMesh, trunkMesh, bushMesh, flowerMesh);

  canopyMesh.visible = palette.TREES_ENABLED;
  trunkMesh.visible = palette.TREES_ENABLED;
  bushMesh.visible = palette.BUSHES_ENABLED;
  flowerMesh.visible = palette.FLOWERS_ENABLED;

  // ── refresh ────────────────────────────────────────────────────
  function refresh(): void {
    const c = PARKS.get();
    const pal = PARKS_PALETTE.get();

    group.visible = c.ENABLED;

    canopyMesh.visible = pal.TREES_ENABLED;
    trunkMesh.visible = pal.TREES_ENABLED;
    bushMesh.visible = pal.BUSHES_ENABLED;
    flowerMesh.visible = pal.FLOWERS_ENABLED;

    setColorFromHex(trunkMaterial.color, pal.TREE_TRUNK_COLOR);

    // Canopy colors are per-instance from pickTreeGreen — rewrite the
    // instanceColor buffer.
    let tI = 0;
    for (const p of placements) {
      for (let t = 0; t < p.treeCount; t++) {
        setColorFromHex(tmpColor, pickTreeGreen(p.seed ^ t));
        canopyMesh.setColorAt(tI++, tmpColor);
      }
    }
    if (canopyMesh.instanceColor) canopyMesh.instanceColor.needsUpdate = true;

    let bI = 0;
    for (const p of placements) {
      for (let b = 0; b < p.bushCount; b++) {
        setColorFromHex(tmpColor, pickBushNeon(p.seed ^ (b * 47 + 5)));
        bushColors[bI * 3 + 0] = tmpColor.r;
        bushColors[bI * 3 + 1] = tmpColor.g;
        bushColors[bI * 3 + 2] = tmpColor.b;
        bI++;
      }
    }
    (bushGeometry.attributes.aColor as THREE.InstancedBufferAttribute).needsUpdate = true;
    bushMaterial.uniforms.uEmissionBoost.value = pal.BUSH_EMISSION_BOOST;

    let fI = 0;
    for (const p of placements) {
      for (let f = 0; f < p.flowerCount; f++) {
        setColorFromHex(tmpColor, pickFlowerColor(p.seed ^ (f * 17 + 11)));
        flowerColors[fI * 3 + 0] = tmpColor.r;
        flowerColors[fI * 3 + 1] = tmpColor.g;
        flowerColors[fI * 3 + 2] = tmpColor.b;
        fI++;
      }
    }
    (flowerGeometry.attributes.aColor as THREE.InstancedBufferAttribute).needsUpdate = true;
    flowerMaterial.uniforms.uEmissionBoost.value = pal.FLOWER_EMISSION_BOOST;
  }

  // ── dispose ────────────────────────────────────────────────────
  function dispose(): void {
    if (group.parent) group.parent.remove(group);
    for (const mesh of [canopyMesh, trunkMesh, bushMesh, flowerMesh]) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
  }

  return { group, refresh, dispose };
}
