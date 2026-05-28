// scene/fireflies/orbitRings.ts — subtle ring around each tree at the
// height + tilt of its firefly orbit.
//
// Renders each ring as a THREE.LineLoop with LineBasicMaterial. This is
// the simplest line-rendering primitive in three.js — one OpenGL line
// strip per ring, no segment shader, no rounded caps. The visible width
// is fixed at 1 pixel (WebGL spec limitation; LineMaterial's pixel-width
// addon caps every internal segment with a rounded end which causes
// visible "dots" at every joint when the line is semi-transparent).
//
// One LineLoop per orb; all share a single LineBasicMaterial so
// refresh() updates color/opacity in one place.
//
//   refresh():  hot-reload color + opacity from current config.
//   dispose():  clean up geometries (per-orb) + the shared material.

import * as THREE from 'three';
import { FIREFLIES } from '@/config/components/fireflies.js';
import type { FireflyPlacement } from './firefliesPlacement.js';

const SEGMENTS_PER_RING = 96;

export interface OrbitRings {
  group: THREE.Group;
  refresh(): void;
  /** No-op for LineBasicMaterial; kept for interface symmetry. */
  onResize(width: number, height: number): void;
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
      onResize() {},
      dispose() {},
    };
  }

  // Shared material — one for all rings; refresh() updates this single
  // instance and every LineLoop picks up the change.
  const material = new THREE.LineBasicMaterial({
    color: new THREE.Color(cfg.ORBIT_RING_COLOR),
    transparent: true,
    opacity: cfg.ORBIT_RING_OPACITY,
    depthWrite: false,
    toneMapped: false,
  });

  // Per-orb: build the loop points and attach a LineLoop to the group.
  const geometries: THREE.BufferGeometry[] = [];
  for (let i = 0; i < orbs.length; i++) {
    const o = orbs[i];
    const r = o.orbitRadius;
    const ct = Math.cos(o.orbitTilt);
    const st = Math.sin(o.orbitTilt);
    const positions = new Float32Array(SEGMENTS_PER_RING * 3);
    for (let s = 0; s < SEGMENTS_PER_RING; s++) {
      const a = (s / SEGMENTS_PER_RING) * Math.PI * 2;
      const x = r * Math.cos(a);
      const zRaw = r * Math.sin(a);
      // Apply per-orb tilt around X (matches firefly vertex shader).
      const y = -st * zRaw;
      const z = ct * zRaw;
      positions[s * 3 + 0] = o.treeX + x;
      positions[s * 3 + 1] = o.height + y;
      positions[s * 3 + 2] = o.treeZ + z;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometries.push(geometry);

    const ring = new THREE.LineLoop(geometry, material);
    ring.frustumCulled = false;
    group.add(ring);
  }

  return {
    group,
    refresh() {
      const next = FIREFLIES.get();
      material.color.set(next.ORBIT_RING_COLOR);
      material.opacity = next.ORBIT_RING_OPACITY;
      group.visible = next.ORBIT_RING_ENABLED;
    },
    onResize() {
      // LineBasicMaterial has no resolution uniform — no-op.
    },
    dispose() {
      for (const g of geometries) g.dispose();
      material.dispose();
      group.clear();
    },
  };
}
