// scene/fireflies/orbitRings.ts — subtle ring around each tree
// at the height + tilt of its firefly orbit. Renders a single
// InstancedMesh of RingGeometry; each instance's matrix encodes the
// tree-center translation, tilt rotation, and orbit-radius scale.
//
//   refresh():   hot-reload color + opacity from current config.
//   dispose():   clean up.

import * as THREE from 'three';
import { FIREFLIES } from '@/config/components/fireflies.js';
import type { FireflyPlacement } from './firefliesPlacement.js';

export interface OrbitRings {
  group: THREE.Group;
  refresh(): void;
  dispose(): void;
}

export function createOrbitRings(orbs: FireflyPlacement[]): OrbitRings {
  const group = new THREE.Group();
  group.name = 'firefly-orbit-rings';

  const cfg = FIREFLIES.get();

  if (!cfg.ORBIT_RING_ENABLED || orbs.length === 0) {
    return {
      group,
      refresh() {},
      dispose() {},
    };
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
    color: new THREE.Color(cfg.ORBIT_RING_COLOR),
    transparent: true,
    opacity: cfg.ORBIT_RING_OPACITY,
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
    // orbitRadius is the world-space target. The ring's instance matrix has
    // no relationship to the firefly's per-author scale; scale by orbitRadius
    // directly to size the unit ring to world units.
    dummy.scale.setScalar(o.orbitRadius);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;

  group.add(mesh);

  return {
    group,
    refresh() {
      const next = FIREFLIES.get();
      material.color.set(next.ORBIT_RING_COLOR);
      material.opacity = next.ORBIT_RING_OPACITY;
      // Visibility flip: hide the entire group when ENABLED is false.
      // Rebuilding on toggle is handled by the structural rebuild path
      // in configCommitReactions; this is purely a fast-path.
      group.visible = next.ORBIT_RING_ENABLED;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      group.remove(mesh);
      mesh.dispose();
    },
  };
}
