// scene/components/fireflies/firefliesRenderer.ts — one InstancedMesh of
// additive-blended smooth icospheres. Per-instance color + phase. The bob
// animation lives in the vertex shader so the CPU never re-writes matrices.
//
//   setTime(seconds): drive the uTime uniform from the render loop.
//   refresh():        hot-reload animation uniforms from current config
//                     (radius + orb count require a full rebuild).
//   dispose():        clean up geometry + material + attribute buffers.

import * as THREE from 'three';
import { RENDER_ORDERS } from '@/city/renderOrders';
import { FIREFLIES } from '@/state/stores/settings/fireflies';
import type { FireflyPlacement } from './firefliesPlacement';
import vertexShader from './fireflies.vert.glsl?raw';
import fragmentShader from './fireflies.frag.glsl?raw';

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

  const cfg = FIREFLIES.value;
  const geometry = new THREE.IcosahedronGeometry(1.0, 2);

  // Per-instance bob phase + pulse phase + orbit params.
  const phaseArray = new Float32Array(orbs.length);
  const pulsePhaseArray = new Float32Array(orbs.length);
  const orbitRadiusArray = new Float32Array(orbs.length);
  const orbitStartAngleArray = new Float32Array(orbs.length);
  const orbitTiltArray = new Float32Array(orbs.length);
  const commitIndexArray = new Float32Array(orbs.length);
  for (let i = 0; i < orbs.length; i++) {
    phaseArray[i] = orbs[i].phase;
    pulsePhaseArray[i] = orbs[i].pulsePhase;
    // orbitRadius is the world-space target radius. The instance matrix
    // has scale = o.scale (sizing the icosphere), and that same scale
    // multiplies the orbital offset in the vertex shader. Pre-divide here
    // so the result cancels out: instanceScale × (orbitRadius / instanceScale)
    // = orbitRadius in world space, regardless of per-author scale.
    const safeScale = orbs[i].scale > 0 ? orbs[i].scale : 1.0;
    orbitRadiusArray[i] = orbs[i].orbitRadius / safeScale;
    orbitStartAngleArray[i] = orbs[i].orbitStartAngle;
    orbitTiltArray[i] = orbs[i].orbitTilt;
    commitIndexArray[i] = orbs[i].commitIndex;
  }
  geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phaseArray, 1));
  geometry.setAttribute('aPulsePhase', new THREE.InstancedBufferAttribute(pulsePhaseArray, 1));
  geometry.setAttribute('aOrbitRadius', new THREE.InstancedBufferAttribute(orbitRadiusArray, 1));
  geometry.setAttribute(
    'aOrbitStartAngle',
    new THREE.InstancedBufferAttribute(orbitStartAngleArray, 1)
  );
  geometry.setAttribute('aOrbitTilt', new THREE.InstancedBufferAttribute(orbitTiltArray, 1));
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

  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uTime,
      uBobAmp,
      uBobSpeed,
      uPulseAmp,
      uPulseSpeed,
      uOrbitSpeed,
      uEmission,
      uFlicker,
      uHoveredCommit,
      uSelectedCommit,
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
    vertexColors: true,
  });

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
      const next = FIREFLIES.value;
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
