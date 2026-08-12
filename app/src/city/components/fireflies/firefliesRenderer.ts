// city/components/fireflies/firefliesRenderer.ts — chunked InstancedMeshes of
// additive-blended smooth icospheres (instanceChunkSize instances per mesh).
// Per-instance color + phase. The bob animation lives in the vertex shader so
// the CPU never re-writes matrices.
//
//   setTime(seconds): drive the uTime uniform from the render loop.
//   refresh():        hot-reload animation uniforms from current config
//                     (radius + orb count require a full rebuild).
//   dispose():        clean up geometry + material + attribute buffers.

import * as THREE from 'three';
import { RENDER_ORDERS } from '@/city/types/renderOrders';
import { FIREFLIES } from '@/state/stores/settings/fireflies';
import { instanceChunkSize } from '@/city/utils/instanceChunkSize';
import { NEUTRAL_POLYGON_OFFSET } from '@/city/utils/neutralPolygonOffset';
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
  refresh(): void;
  dispose(): void;
}

/** Name of the instanced orb mesh, so consumers can find it on the graph. */
export const FIREFLY_ORBS_MESH = 'fireflies-orbs';

export function createFireflyRenderer(orbs: FireflyPlacement[]): FireflyRenderer {
  const group = new THREE.Group();
  group.name = 'fireflies';

  if (orbs.length === 0) {
    return {
      group,
      setTime() {},
      setHoveredCommit() {},
      setSelectedCommit() {},
      setScrubCommit() {},
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
    ...NEUTRAL_POLYGON_OFFSET,
  });

  // Orbs are split into chunks of instances (see utils/instanceChunkSize.ts).
  // Each chunk carries its own geometry because the orbit params are
  // per-instance attributes on it; the material is shared.
  //
  // Chunk membership is SPATIAL (coarse grid tiles) so each chunk covers a
  // compact region and per-chunk frustum culling drops off-screen orbs —
  // load-bearing on mobile drivers that corrupt when fed masses of
  // far-out-of-frustum instances (see treeRenderer for the full story).
  const chunkSize = instanceChunkSize();
  const SPATIAL_TILE = 256;
  const spatialOrder = new Array<number>(orbs.length);
  for (let i = 0; i < orbs.length; i++) spatialOrder[i] = i;
  spatialOrder.sort((a, b) => {
    const az = Math.floor(orbs[a].treeZ / SPATIAL_TILE);
    const bz = Math.floor(orbs[b].treeZ / SPATIAL_TILE);
    if (az !== bz) return az - bz;
    const ax = Math.floor(orbs[a].treeX / SPATIAL_TILE);
    const bx = Math.floor(orbs[b].treeX / SPATIAL_TILE);
    if (ax !== bx) return ax - bx;
    return a - b;
  });
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  // Full-scale matrix per ORB index, kept so setScrubCommit can restore a
  // gated-out orb without recomputing it.
  const fullMatrix = new Array<THREE.Matrix4>(orbs.length);
  // Parallel arrays: meshes[c]'s slot k renders orb chunkOrders[c][k]. The
  // culling sphere is the instance sphere inflated by the chunk's worst-case
  // shader-side displacement (orbit radius + bob), re-inflated on refresh()
  // when the bob amplitude changes.
  const meshes: THREE.InstancedMesh[] = [];
  const chunkOrders: number[][] = [];
  const chunkBaseRadius: number[] = [];
  const chunkMaxOrbit: number[] = [];

  for (let start = 0; start < orbs.length; start += chunkSize) {
    const len = Math.min(chunkSize, orbs.length - start);
    const chunkOrder = new Array<number>(len);
    for (let k = 0; k < len; k++) chunkOrder[k] = spatialOrder[start + k];
    const geometry = new THREE.IcosahedronGeometry(1.0, 2);

    // Per-instance bob phase + pulse phase + orbit params for this chunk.
    const phaseArray = new Float32Array(len);
    const pulsePhaseArray = new Float32Array(len);
    const orbitRadiusArray = new Float32Array(len);
    const orbitStartAngleArray = new Float32Array(len);
    const orbitTiltArray = new Float32Array(len);
    const commitIndexArray = new Float32Array(len);
    let maxWorldOrbit = 0;
    for (let k = 0; k < len; k++) {
      const o = orbs[chunkOrder[k]];
      if (o.orbitRadius > maxWorldOrbit) maxWorldOrbit = o.orbitRadius;
      phaseArray[k] = o.phase;
      pulsePhaseArray[k] = o.pulsePhase;
      // orbitRadius is the world-space target radius. The instance matrix
      // has scale = o.scale (sizing the icosphere), and that same scale
      // multiplies the orbital offset in the vertex shader. Pre-divide here
      // so the result cancels out: instanceScale × (orbitRadius / instanceScale)
      // = orbitRadius in world space, regardless of per-author scale.
      const safeScale = o.scale > 0 ? o.scale : 1.0;
      orbitRadiusArray[k] = o.orbitRadius / safeScale;
      orbitStartAngleArray[k] = o.orbitStartAngle;
      orbitTiltArray[k] = o.orbitTilt;
      commitIndexArray[k] = o.commitIndex;
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

    const mesh = new THREE.InstancedMesh(geometry, material, len);
    mesh.name = FIREFLY_ORBS_MESH;
    mesh.renderOrder = RENDER_ORDERS.FIREFLIES;

    for (let k = 0; k < len; k++) {
      const o = orbs[chunkOrder[k]];
      dummy.position.set(o.treeX, o.height, o.treeZ);
      dummy.scale.setScalar(o.scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(k, dummy.matrix);
      fullMatrix[chunkOrder[k]] = dummy.matrix.clone();
      // rgb values from FireflyPlacement are already linear-RGB (0..1).
      // Pass LinearSRGBColorSpace explicitly so three.js skips any
      // working-color-space conversion that would double-apply gamma.
      color.setRGB(o.rgb[0], o.rgb[1], o.rgb[2], THREE.LinearSRGBColorSpace);
      mesh.setColorAt(k, color);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    // Culling sphere: instance sphere + the shader-side displacement the
    // matrices don't know about (orbit radius in XZ/tilt, bob in Y).
    mesh.computeBoundingSphere();
    const baseRadius = mesh.boundingSphere ? mesh.boundingSphere.radius : 0;
    if (mesh.boundingSphere)
      mesh.boundingSphere.radius = baseRadius + maxWorldOrbit + uBobAmp.value;

    group.add(mesh);
    meshes.push(mesh);
    chunkOrders.push(chunkOrder);
    chunkBaseRadius.push(baseRadius);
    chunkMaxOrbit.push(maxWorldOrbit);
  }

  const ZERO_SCALE_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0);
  // Threshold applied by the last setScrubCommit call. Starts at null (every orb full-scale, matching the build above).
  let _scrubCommit: number | null = null;

  function scrubVisible(commitIndex: number, threshold: number | null): boolean {
    return threshold === null || commitIndex <= threshold;
  }

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
    setScrubCommit(maxCommitIndex: number | null) {
      if (maxCommitIndex === _scrubCommit) return;
      for (let c = 0; c < meshes.length; c++) {
        const mesh = meshes[c];
        const chunkOrder = chunkOrders[c];
        let changed = false;
        for (let k = 0; k < mesh.count; k++) {
          const i = chunkOrder[k];
          const wasVisible = scrubVisible(orbs[i].commitIndex, _scrubCommit);
          const nowVisible = scrubVisible(orbs[i].commitIndex, maxCommitIndex);
          if (wasVisible === nowVisible) continue;
          mesh.setMatrixAt(k, nowVisible ? fullMatrix[i] : ZERO_SCALE_MATRIX);
          changed = true;
        }
        if (changed) mesh.instanceMatrix.needsUpdate = true;
      }
      _scrubCommit = maxCommitIndex;
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
      // Bob amplitude feeds the culling spheres — re-inflate on change.
      for (let c = 0; c < meshes.length; c++) {
        const sphere = meshes[c].boundingSphere;
        if (sphere) sphere.radius = chunkBaseRadius[c] + chunkMaxOrbit[c] + next.BOB_AMPLITUDE;
      }
    },
    dispose() {
      material.dispose();
      for (const mesh of meshes) {
        mesh.geometry.dispose();
        group.remove(mesh);
        mesh.dispose();
      }
    },
  };
}
