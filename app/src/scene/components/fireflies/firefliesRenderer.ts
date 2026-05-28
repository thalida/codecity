// scene/fireflies/firefliesRenderer.ts — one InstancedMesh of
// additive-blended icospheres. Per-instance color + phase. The bob
// animation lives in the vertex shader (via onBeforeCompile) so the
// CPU never re-writes 750k matrices per frame.
//
//   setTime(seconds): drive the uTime uniform from the render loop.
//   dispose():        clean up geometry + material + attribute buffers.

import * as THREE from 'three';
import { RENDER_ORDERS } from '@/constants';
import type { FireflyPlacement } from './firefliesPlacement.js';

const ORB_RADIUS = 0.12;      // world units; small mote
const BOB_AMPLITUDE = 0.18;   // half tree-trunk-width
const BOB_SPEED = 1.1;        // radians per second

export interface FireflyRenderer {
  group: THREE.Group;
  setTime(seconds: number): void;
  dispose(): void;
}

export function createFireflyRenderer(orbs: FireflyPlacement[]): FireflyRenderer {
  const group = new THREE.Group();
  group.name = 'fireflies';

  if (orbs.length === 0) {
    return {
      group,
      setTime() {},
      dispose() {},
    };
  }

  const geometry = new THREE.IcosahedronGeometry(ORB_RADIUS, 0);

  // Per-instance phase attribute (one float per orb).
  const phaseArray = new Float32Array(orbs.length);
  for (let i = 0; i < orbs.length; i++) phaseArray[i] = orbs[i].phase;
  geometry.setAttribute(
    'aPhase',
    new THREE.InstancedBufferAttribute(phaseArray, 1),
  );

  const uTime = { value: 0 };

  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.uniforms.uAmp = { value: BOB_AMPLITUDE };
    shader.uniforms.uSpeed = { value: BOB_SPEED };

    // Inject the per-instance phase attribute declaration after <common>.
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>
       attribute float aPhase;
       uniform float uTime;
       uniform float uAmp;
       uniform float uSpeed;`,
    );

    // Bob the y-component of the instance translation after <begin_vertex>
    // sets `transformed = position`, but before the model-view projection.
    // This moves each orb vertically in its local (instance) space, which
    // (combined with the instance matrix's translation) produces a smooth
    // world-space vertical bob.
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       transformed.y += sin(uTime * uSpeed + aPhase) * uAmp;`,
    );
  };

  const mesh = new THREE.InstancedMesh(geometry, material, orbs.length);
  mesh.name = 'fireflies-orbs';
  mesh.frustumCulled = false;
  mesh.renderOrder = RENDER_ORDERS.FIREFLIES;

  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  for (let i = 0; i < orbs.length; i++) {
    const o = orbs[i];
    dummy.position.set(o.x, o.height, o.z);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    // rgb values from FireflyPlacement are already linear-RGB (0..1).
    // Pass LinearSRGBColorSpace explicitly so three.js skips any
    // working-color-space conversion that would double-apply gamma.
    color.setRGB(o.rgb[0], o.rgb[1], o.rgb[2], THREE.LinearSRGBColorSpace);
    mesh.setColorAt(i, color);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

  group.add(mesh);

  return {
    group,
    setTime(seconds: number) {
      uTime.value = seconds;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      group.remove(mesh);
    },
  };
}
