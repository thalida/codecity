// scene/fireflies/orbitRings.ts — subtle white ring around each tree
// at the height + tilt of its firefly orbit. Renders a single
// InstancedMesh of RingGeometry; each instance's matrix encodes the
// tree-center translation, tilt rotation, and orbit-radius scale.
//
//   refresh():   no-op for v1 (no tunable uniforms yet).
//   dispose():   clean up.

import * as THREE from 'three';
import type { FireflyPlacement } from './firefliesPlacement.js';

const RING_OPACITY = 0.18;

export interface OrbitRings {
  group: THREE.Group;
  dispose(): void;
}

export function createOrbitRings(orbs: FireflyPlacement[]): OrbitRings {
  const group = new THREE.Group();
  group.name = 'firefly-orbit-rings';

  if (orbs.length === 0) {
    return { group, dispose() {} };
  }

  // Unit-radius ring; per-instance scale brings it to the orb's actual
  // orbital radius. Thin annulus (inner 0.98, outer 1.02) so the ring
  // reads as a circle outline rather than a flat disc.
  const geometry = new THREE.RingGeometry(0.98, 1.02, 64);
  // RingGeometry's default parameterization is (cos θ, sin θ, 0) in the
  // XY plane. We want (cos θ, 0, sin θ) so the ring matches the
  // firefly's orbital path: x = R*cos(angle), z = R*sin(angle) at zero
  // tilt. That requires +π/2 around X — the −π/2 version is mirrored
  // and tilts the opposite way under per-instance rotation, which
  // makes the ring trace a different arc than the firefly follows.
  geometry.rotateX(Math.PI / 2);

  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: RING_OPACITY,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });

  const mesh = new THREE.InstancedMesh(geometry, material, orbs.length);
  mesh.frustumCulled = false;

  const dummy = new THREE.Object3D();
  for (let i = 0; i < orbs.length; i++) {
    const o = orbs[i];
    dummy.position.set(o.treeX, o.height, o.treeZ);
    dummy.rotation.set(o.orbitTilt, 0, 0);
    dummy.scale.setScalar(o.orbitRadius);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;

  group.add(mesh);

  return {
    group,
    dispose() {
      geometry.dispose();
      material.dispose();
      group.remove(mesh);
      mesh.dispose();
    },
  };
}
