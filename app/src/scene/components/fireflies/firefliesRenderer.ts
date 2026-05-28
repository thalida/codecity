// scene/fireflies/firefliesRenderer.ts — one InstancedMesh of
// additive-blended icospheres. Per-instance color + phase. The bob
// animation lives in the vertex shader (via onBeforeCompile) so the
// CPU never re-writes 750k matrices per frame.
//
//   setTime(seconds): drive the uTime uniform from the render loop.
//   refresh():        hot-reload animation uniforms from current config
//                     (radius + orb count require a full rebuild).
//   dispose():        clean up geometry + material + attribute buffers.

import * as THREE from 'three';
import { RENDER_ORDERS } from '@/constants';
import { FIREFLIES } from '@/config/components/fireflies.js';
import type { FireflyPlacement } from './firefliesPlacement.js';

export interface FireflyRenderer {
  group: THREE.Group;
  setTime(seconds: number): void;
  refresh(): void;
  dispose(): void;
}

export function createFireflyRenderer(orbs: FireflyPlacement[]): FireflyRenderer {
  const group = new THREE.Group();
  group.name = 'fireflies';

  if (orbs.length === 0) {
    return {
      group,
      setTime() {},
      refresh() {},
      dispose() {},
    };
  }

  const cfg = FIREFLIES.get();
  const geometry = new THREE.IcosahedronGeometry(cfg.FIREFLY_RADIUS, 0);

  // Per-instance bob phase (existing) + per-instance pulse phase (new).
  const phaseArray = new Float32Array(orbs.length);
  const pulsePhaseArray = new Float32Array(orbs.length);
  for (let i = 0; i < orbs.length; i++) {
    phaseArray[i] = orbs[i].phase;
    pulsePhaseArray[i] = orbs[i].pulsePhase;
  }
  geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phaseArray, 1));
  geometry.setAttribute('aPulsePhase', new THREE.InstancedBufferAttribute(pulsePhaseArray, 1));

  const uTime = { value: 0 };
  const uBobAmp = { value: cfg.BOB_AMPLITUDE };
  const uBobSpeed = { value: cfg.BOB_SPEED };
  const uPulseAmp = { value: cfg.PULSE_AMPLITUDE };
  const uPulseSpeed = { value: cfg.PULSE_SPEED };

  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });

  // Shader injection patches the built-in MeshBasicMaterial vertex
  // shader's '<common>' and '<begin_vertex>' chunks. These chunk
  // names are part of three.js's stable glsl chunk API (since r80+),
  // but a future major upgrade could rename them — revisit on bump.
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.uniforms.uBobAmp = uBobAmp;
    shader.uniforms.uBobSpeed = uBobSpeed;
    shader.uniforms.uPulseAmp = uPulseAmp;
    shader.uniforms.uPulseSpeed = uPulseSpeed;

    // VERTEX: declare per-instance attributes + uniforms, compute bob, output pulse varying.
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>
       attribute float aPhase;
       attribute float aPulsePhase;
       uniform float uTime;
       uniform float uBobAmp;
       uniform float uBobSpeed;
       uniform float uPulseAmp;
       uniform float uPulseSpeed;
       varying float vPulse;`,
    );

    // Bob the y-component of the instance translation after <begin_vertex>
    // sets `transformed = position`, but before the model-view projection.
    // This moves each orb vertically in its local (instance) space, which
    // (combined with the instance matrix's translation) produces a smooth
    // world-space vertical bob.
    // Also compute the brightness pulse varying for this orb.
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       transformed.y += sin(uTime * uBobSpeed + aPhase) * uBobAmp;
       vPulse = 1.0 + uPulseAmp * sin(uTime * uPulseSpeed + aPulsePhase);`,
    );

    // FRAGMENT: declare varying + multiply final color by vPulse.
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
       varying float vPulse;`,
    );
    // Multiply the final output color by the pulse factor. Three.js's
    // built-in MeshBasicMaterial sets `gl_FragColor` near the end of main();
    // safely patch by replacing the <output_fragment> include with one that
    // applies the pulse after the include's own assignment.
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <output_fragment>',
      `#include <output_fragment>
       gl_FragColor.rgb *= vPulse;`,
    );
  };

  const mesh = new THREE.InstancedMesh(geometry, material, orbs.length);
  mesh.name = 'fireflies-orbs';
  // Culling is disabled because the shader-side y-bob shifts vertices
  // outside the mesh's bounding sphere, which would otherwise cause
  // three.js to cull instances mid-bob.
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
    refresh() {
      const next = FIREFLIES.get();
      uBobAmp.value = next.BOB_AMPLITUDE;
      uBobSpeed.value = next.BOB_SPEED;
      uPulseAmp.value = next.PULSE_AMPLITUDE;
      uPulseSpeed.value = next.PULSE_SPEED;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      group.remove(mesh);
      mesh.dispose();
    },
  };
}
