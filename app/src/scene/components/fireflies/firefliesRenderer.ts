// scene/fireflies/firefliesRenderer.ts — one InstancedMesh of
// additive-blended smooth icospheres. Per-instance color + phase. The bob
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
  setHoveredCommit(commitIndex: number | null): void;
  setSelectedCommit(commitIndex: number | null): void;
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
      setHoveredCommit() {},
      setSelectedCommit() {},
      refresh() {},
      dispose() {},
    };
  }

  const HOVER_BRIGHTNESS_BOOST = 3.0;
  const SELECT_BRIGHTNESS_BOOST = 6.0;
  const HOVER_SCALE_BOOST = 1.6;
  const SELECT_SCALE_BOOST = 2.2;

  const cfg = FIREFLIES.get();
  const geometry = new THREE.IcosahedronGeometry(1.0, 2);

  // Per-instance bob phase (existing) + per-instance pulse phase + orbit params (new).
  const phaseArray = new Float32Array(orbs.length);
  const pulsePhaseArray = new Float32Array(orbs.length);
  const orbitRadiusArray = new Float32Array(orbs.length);
  const orbitStartAngleArray = new Float32Array(orbs.length);
  const commitIndexArray = new Float32Array(orbs.length);
  for (let i = 0; i < orbs.length; i++) {
    phaseArray[i] = orbs[i].phase;
    pulsePhaseArray[i] = orbs[i].pulsePhase;
    orbitRadiusArray[i] = orbs[i].orbitRadius;
    orbitStartAngleArray[i] = orbs[i].orbitStartAngle;
    commitIndexArray[i] = orbs[i].commitIndex;
  }
  geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phaseArray, 1));
  geometry.setAttribute('aPulsePhase', new THREE.InstancedBufferAttribute(pulsePhaseArray, 1));
  geometry.setAttribute('aOrbitRadius', new THREE.InstancedBufferAttribute(orbitRadiusArray, 1));
  geometry.setAttribute('aOrbitStartAngle', new THREE.InstancedBufferAttribute(orbitStartAngleArray, 1));
  geometry.setAttribute('aCommitIndex', new THREE.InstancedBufferAttribute(commitIndexArray, 1));

  const uTime = { value: 0 };
  const uBobAmp = { value: cfg.BOB_AMPLITUDE };
  const uBobSpeed = { value: cfg.BOB_SPEED };
  const uPulseAmp = { value: cfg.PULSE_AMPLITUDE };
  const uPulseSpeed = { value: cfg.PULSE_SPEED };
  const uOrbitSpeed = { value: cfg.ORBIT_SPEED };
  const uEmission = { value: cfg.EMISSION_STRENGTH };
  const uFlicker = { value: cfg.FLICKER_AMOUNT };
  const uHoveredCommit = { value: -1.0 };
  const uSelectedCommit = { value: -1.0 };

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
    shader.uniforms.uOrbitSpeed = uOrbitSpeed;
    shader.uniforms.uEmission = uEmission;
    shader.uniforms.uFlicker = uFlicker;
    shader.uniforms.uHoveredCommit = uHoveredCommit;
    shader.uniforms.uSelectedCommit = uSelectedCommit;

    // VERTEX: declare per-instance attributes + uniforms, compute orbit + bob, output pulse varying.
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>
       attribute float aPhase;
       attribute float aPulsePhase;
       attribute float aOrbitRadius;
       attribute float aOrbitStartAngle;
       attribute float aCommitIndex;
       uniform float uTime;
       uniform float uBobAmp;
       uniform float uBobSpeed;
       uniform float uPulseAmp;
       uniform float uPulseSpeed;
       uniform float uOrbitSpeed;
       uniform float uHoveredCommit;
       uniform float uSelectedCommit;
       varying float vPulse;
       varying float vCommitIndex;`,
    );

    // Apply orbital offset in XZ and bob in Y after <begin_vertex> sets
    // `transformed = position`, but before model-view projection.
    // The instance matrix translates to the tree center; the shader adds the
    // time-varying orbital offset so the CPU never re-writes instance matrices.
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       // Hover / select size boost. Multiplies the local icosphere position
       // before the orbit/bob displacement. The instance matrix scale (per-
       // author commit-count scaling) still composes on top of this.
       float scaleBoost = 1.0;
       if (uSelectedCommit >= 0.0 && abs(aCommitIndex - uSelectedCommit) < 0.5) {
         scaleBoost = ${SELECT_SCALE_BOOST.toFixed(2)};
       } else if (uHoveredCommit >= 0.0 && abs(aCommitIndex - uHoveredCommit) < 0.5) {
         scaleBoost = ${HOVER_SCALE_BOOST.toFixed(2)};
       }
       transformed *= scaleBoost;

       // Orbital XZ displacement around the tree's vertical axis.
       float orbitAngle = aOrbitStartAngle + uTime * uOrbitSpeed;
       transformed.x += aOrbitRadius * cos(orbitAngle);
       transformed.z += aOrbitRadius * sin(orbitAngle);

       // Vertical bob.
       transformed.y += sin(uTime * uBobSpeed + aPhase) * uBobAmp;

       // Pulse phase passed to the fragment shader.
       vPulse = 1.0 + uPulseAmp * sin(uTime * uPulseSpeed + aPulsePhase);
       vCommitIndex = aCommitIndex;`,
    );

    // FRAGMENT: declare varying + uniforms, then multiply final color by
    // the composed brightness pipeline: vPulse × flicker × emission × boost.
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
       varying float vPulse;
       varying float vCommitIndex;
       uniform float uTime;
       uniform float uEmission;
       uniform float uFlicker;
       uniform float uHoveredCommit;
       uniform float uSelectedCommit;`,
    );
    // Multiply the final output color by the composed brightness signal.
    // Three.js's built-in MeshBasicMaterial sets `gl_FragColor` near the
    // end of main(); safely patch by replacing the <output_fragment>
    // include with one that applies the chain after the include's own
    // assignment.
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <output_fragment>',
      `#include <output_fragment>
       // Flicker: high-frequency pseudo-random brightness noise, layered on
       // top of the smooth pulse. Hash-based so it's deterministic per fragment
       // but varies wildly with time.
       float flickerNoise = fract(sin(uTime * 17.0 + vPulse * 13.0) * 43758.5453);
       float flicker = mix(1.0, flickerNoise, uFlicker);
       // Hover / select boost. Select beats hover when both match.
       float boost = 1.0;
       if (uSelectedCommit >= 0.0 && abs(vCommitIndex - uSelectedCommit) < 0.5) {
         boost = ${SELECT_BRIGHTNESS_BOOST.toFixed(2)};
       } else if (uHoveredCommit >= 0.0 && abs(vCommitIndex - uHoveredCommit) < 0.5) {
         boost = ${HOVER_BRIGHTNESS_BOOST.toFixed(2)};
       }
       gl_FragColor.rgb *= vPulse * flicker * uEmission * boost;`,
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
    dummy.position.set(o.treeX, o.height, o.treeZ);
    dummy.scale.setScalar(o.scale);
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
    setHoveredCommit(commitIndex: number | null) {
      uHoveredCommit.value = commitIndex ?? -1;
    },
    setSelectedCommit(commitIndex: number | null) {
      uSelectedCommit.value = commitIndex ?? -1;
    },
    refresh() {
      const next = FIREFLIES.get();
      uBobAmp.value = next.BOB_AMPLITUDE;
      uBobSpeed.value = next.BOB_SPEED;
      uPulseAmp.value = next.PULSE_AMPLITUDE;
      uPulseSpeed.value = next.PULSE_SPEED;
      uOrbitSpeed.value = next.ORBIT_SPEED;
      uEmission.value = next.EMISSION_STRENGTH;
      uFlicker.value = next.FLICKER_AMOUNT;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      group.remove(mesh);
      mesh.dispose();
    },
  };
}
