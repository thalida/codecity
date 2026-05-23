// scene/bushes/bushRenderer.ts — turns a BushPlacement[] into one
// InstancedMesh of HDR-emissive icosahedra.
//
//   bush-mesh — emissive icosahedra (one per placement)
//
// The custom ShaderMaterial multiplies per-instance color by
// uEmissionBoost, pushing values above 1.0 into HDR bloom.
//
// `refresh()` rewrites per-instance color attributes from BUSHES and
// updates the emission uniform; it never rebuilds the InstancedMesh.

import * as THREE from 'three';
import { TREES } from '@/config/trees.js';
import { BUSHES } from '@/config/bushes.js';
import { RENDER_ORDERS } from '@/constants';
import { pickBushNeon } from './bushPalette.js';
import type { BushPlacement } from './bushPlacement.js';

export interface Bushes {
  group: THREE.Group;
  refresh(): void;
  dispose(): void;
}

const EMISSIVE_VERT = /* glsl */ `
attribute vec3 aColor;
varying vec3 vColor;
void main() {
  vColor = aColor;
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

function setColorFromHex(target: THREE.Color, hex: string): void {
  target.setStyle(hex, THREE.LinearSRGBColorSpace);
}

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

export function createBushRenderer(placements: BushPlacement[]): Bushes {
  const treesCfg = TREES.get();
  const bushesCfg = BUSHES.get();

  // Bushes scale to the "typical" tree canopy radius: midpoint of the
  // files-driven canopy diameter range (now in absolute world units),
  // converted to a radius.
  const treeRadius = ((treesCfg.TREE_MIN_WIDTH + treesCfg.TREE_MAX_WIDTH) / 2) / 2;
  const bushRadius = bushesCfg.BUSH_RADIUS_FRAC_OF_TREE * treeRadius;

  const totalBushes = placements.length;

  const bushMaterial = new THREE.ShaderMaterial({
    vertexShader: EMISSIVE_VERT,
    fragmentShader: EMISSIVE_FRAG,
    uniforms: {
      uEmissionBoost: { value: bushesCfg.BUSH_EMISSION_BOOST },
    },
  });

  const bushGeometry = new THREE.IcosahedronGeometry(bushRadius, 0);

  const bushColors = new Float32Array(totalBushes * 3);
  bushGeometry.setAttribute(
    'aColor',
    new THREE.InstancedBufferAttribute(bushColors, 3),
  );

  const bushMesh = new THREE.InstancedMesh(bushGeometry, bushMaterial, totalBushes);
  bushMesh.name = 'bush-mesh';
  bushMesh.renderOrder = RENDER_ORDERS.PARK_FOLIAGE;
  bushMesh.frustumCulled = false;

  const tmpMatrix = new THREE.Matrix4();
  const tmpV3a = new THREE.Vector3();
  const tmpV3b = new THREE.Vector3();
  const tmpQ = new THREE.Quaternion();
  const tmpColor = new THREE.Color();

  for (let i = 0; i < placements.length; i++) {
    const p = placements[i];
    setInstanceMatrix(
      bushMesh, i,
      p.x, bushRadius * 0.5, p.y,
      1, 1, 1,
      tmpMatrix, tmpV3a, tmpV3b, tmpQ,
    );
    setColorFromHex(tmpColor, pickBushNeon(p.seed ^ (i * 47 + 5)));
    bushColors[i * 3 + 0] = tmpColor.r;
    bushColors[i * 3 + 1] = tmpColor.g;
    bushColors[i * 3 + 2] = tmpColor.b;
  }

  bushMesh.instanceMatrix.needsUpdate = true;
  (bushGeometry.attributes.aColor as THREE.InstancedBufferAttribute).needsUpdate = true;

  const group = new THREE.Group();
  group.name = 'bushes';
  group.userData.cyberpunkValley = 'bushes';
  group.visible = bushesCfg.BUSHES_ENABLED;
  group.add(bushMesh);

  bushMesh.visible = bushesCfg.BUSHES_ENABLED;

  function refresh(): void {
    const bc = BUSHES.get();

    group.visible = bc.BUSHES_ENABLED;
    bushMesh.visible = bc.BUSHES_ENABLED;

    for (let i = 0; i < placements.length; i++) {
      setColorFromHex(tmpColor, pickBushNeon(placements[i].seed ^ (i * 47 + 5)));
      bushColors[i * 3 + 0] = tmpColor.r;
      bushColors[i * 3 + 1] = tmpColor.g;
      bushColors[i * 3 + 2] = tmpColor.b;
    }
    (bushGeometry.attributes.aColor as THREE.InstancedBufferAttribute).needsUpdate = true;
    bushMaterial.uniforms.uEmissionBoost.value = bc.BUSH_EMISSION_BOOST;
  }

  function dispose(): void {
    if (group.parent) group.parent.remove(group);
    bushGeometry.dispose();
    bushMaterial.dispose();
  }

  return { group, refresh, dispose };
}
