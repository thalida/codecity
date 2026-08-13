// city/components/fireflies/firefliesRenderer.ts — one THREE.Points draw:
// one VERTEX per orb, orbit/bob in the vertex shader, round glow in the
// fragment. Deliberately NOT instanced icospheres — those glitched a mobile
// driver (Samsung Xclipse) under both browsers' GL stacks; ~50 bytes/orb.

import * as THREE from 'three';
import { RENDER_ORDERS } from '@/city/types/renderOrders';
import { VEC3_COMPONENTS } from '@/city/utils/bufferLayout';
import { FIREFLIES } from '@/state/stores/settings/fireflies';
import type { FireflyPlacement } from './firefliesPlacement';
import vertexShader from './fireflies.vert.glsl?raw';
import fragmentShader from './fireflies.frag.glsl?raw';

export interface FireflyRenderer {
  group: THREE.Group;
  setTime(seconds: number): void;
  setHoveredCommit(commitIndex: number | null): void;
  setSelectedCommit(commitIndex: number | null): void;
  /** Timeline scrub gate: hide orbs whose commitIndex is past maxCommitIndex. Null restores all. */
  setScrubCommit(maxCommitIndex: number | null): void;
  /** Re-read scale and orbit geometry off the placements, which the scrub
   *  resizes in place. */
  uploadSizes(): void;
  refresh(): void;
  dispose(): void;
}

/** Name of the orbs points object, so consumers can find it on the graph. */
export const FIREFLY_ORBS_MESH = 'fireflies-orbs';

export function createFireflyRenderer(
  orbs: FireflyPlacement[],
  canvas?: HTMLCanvasElement
): FireflyRenderer {
  const group = new THREE.Group();
  group.name = 'fireflies';

  if (orbs.length === 0) {
    return {
      group,
      setTime() {},
      setHoveredCommit() {},
      setSelectedCommit() {},
      setScrubCommit() {},
      uploadSizes() {},
      refresh() {},
      dispose() {},
    };
  }

  const cfg = FIREFLIES.value;

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
  const uScrubCommit = { value: -1.0 };
  // canvas.height = drawing-buffer device pixels, gl_PointSize's unit,
  // refreshed per frame in setTime. The fallback only applies without a canvas.
  const HEADLESS_VIEWPORT_PX = 2048;
  const uHalfViewportHeight = { value: (canvas?.height ?? HEADLESS_VIEWPORT_PX) / 2 };

  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(orbs.length * VEC3_COMPONENTS);
  const colors = new Float32Array(orbs.length * VEC3_COMPONENTS);
  const phaseArray = new Float32Array(orbs.length);
  const pulsePhaseArray = new Float32Array(orbs.length);
  const orbitRadiusArray = new Float32Array(orbs.length);
  const orbitStartAngleArray = new Float32Array(orbs.length);
  const orbitTiltArray = new Float32Array(orbs.length);
  const commitIndexArray = new Float32Array(orbs.length);
  const scaleArray = new Float32Array(orbs.length);
  let maxWorldOrbit = 0;
  let maxScale = 0;
  for (let i = 0; i < orbs.length; i++) {
    const o = orbs[i];
    const v = i * VEC3_COMPONENTS;
    positions[v] = o.treeX;
    positions[v + 1] = o.height;
    positions[v + 2] = o.treeZ;
    // uploadSizes re-reads height, radius and scale; the rest is fixed for the
    // life of the field. The colours are already linear, so they pass raw.
    colors[v] = o.rgb[0];
    colors[v + 1] = o.rgb[1];
    colors[v + 2] = o.rgb[2];
    phaseArray[i] = o.phase;
    pulsePhaseArray[i] = o.pulsePhase;
    orbitRadiusArray[i] = o.orbitRadius;
    orbitStartAngleArray[i] = o.orbitStartAngle;
    orbitTiltArray[i] = o.orbitTilt;
    commitIndexArray[i] = o.commitIndex;
    scaleArray[i] = o.scale;
    if (o.orbitRadius > maxWorldOrbit) maxWorldOrbit = o.orbitRadius;
    if (o.scale > maxScale) maxScale = o.scale;
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, VEC3_COMPONENTS));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, VEC3_COMPONENTS));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phaseArray, 1));
  geometry.setAttribute('aPulsePhase', new THREE.BufferAttribute(pulsePhaseArray, 1));
  geometry.setAttribute('aOrbitRadius', new THREE.BufferAttribute(orbitRadiusArray, 1));
  geometry.setAttribute('aOrbitStartAngle', new THREE.BufferAttribute(orbitStartAngleArray, 1));
  geometry.setAttribute('aOrbitTilt', new THREE.BufferAttribute(orbitTiltArray, 1));
  geometry.setAttribute('aCommitIndex', new THREE.BufferAttribute(commitIndexArray, 1));
  geometry.setAttribute('aScale', new THREE.BufferAttribute(scaleArray, 1));

  // Culling sphere: orb centers plus the shader-side displacement the
  // positions don't know about (orbit radius, bob, the point's own radius).
  function inflateBoundingSphere(bobAmp: number): void {
    geometry.computeBoundingSphere();
    if (geometry.boundingSphere) {
      geometry.boundingSphere.radius += maxWorldOrbit + bobAmp + maxScale;
    }
  }
  inflateBoundingSphere(cfg.BOB_AMPLITUDE);

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
      uScrubCommit,
      uHalfViewportHeight,
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
    vertexColors: true,
  });

  const points = new THREE.Points(geometry, material);
  points.name = FIREFLY_ORBS_MESH;
  points.renderOrder = RENDER_ORDERS.FIREFLIES;
  group.add(points);

  return {
    group,
    setTime(seconds: number) {
      uTime.value = seconds;
      if (canvas) uHalfViewportHeight.value = canvas.height / 2;
    },
    setHoveredCommit(commitIndex: number | null) {
      uHoveredCommit.value = commitIndex ?? -1;
    },
    setSelectedCommit(commitIndex: number | null) {
      uSelectedCommit.value = commitIndex ?? -1;
    },
    setScrubCommit(maxCommitIndex: number | null) {
      uScrubCommit.value = maxCommitIndex ?? -1;
    },
    uploadSizes() {
      maxWorldOrbit = 0;
      maxScale = 0;
      for (let i = 0; i < orbs.length; i++) {
        const o = orbs[i];
        positions[i * VEC3_COMPONENTS + 1] = o.height;
        orbitRadiusArray[i] = o.orbitRadius;
        scaleArray[i] = o.scale;
        if (o.orbitRadius > maxWorldOrbit) maxWorldOrbit = o.orbitRadius;
        if (o.scale > maxScale) maxScale = o.scale;
      }
      geometry.getAttribute('position').needsUpdate = true;
      geometry.getAttribute('aOrbitRadius').needsUpdate = true;
      geometry.getAttribute('aScale').needsUpdate = true;
      inflateBoundingSphere(uBobAmp.value);
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
      inflateBoundingSphere(next.BOB_AMPLITUDE);
    },
    dispose() {
      material.dispose();
      geometry.dispose();
      group.remove(points);
    },
  };
}
