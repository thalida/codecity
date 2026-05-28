// scene/fireflies/orbitRings.ts — subtle ring around each tree at the
// height + tilt of its firefly orbit. Renders as a single Line2 (pixel
// line width via LineMaterial) so the ring thickness is constant
// regardless of orbital radius or camera distance.
//
//   refresh():  hot-reload color + opacity from current config.
//   dispose():  clean up geometry + material.

import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { FIREFLIES } from '@/config/components/fireflies.js';
import type { FireflyPlacement } from './firefliesPlacement.js';

const SEGMENTS_PER_RING = 64;

export interface OrbitRings {
  group: THREE.Group;
  refresh(): void;
  /** Update the material's resolution uniform on canvas resize. */
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

  // Build the positions array — each orb contributes SEGMENTS_PER_RING
  // line segments forming a circle in its tilted orbital plane.
  // LineSegmentsGeometry expects pairs of (x0,y0,z0, x1,y1,z1) per segment.
  const floatsPerOrb = SEGMENTS_PER_RING * 2 * 3;
  const positions = new Float32Array(orbs.length * floatsPerOrb);

  for (let i = 0; i < orbs.length; i++) {
    const o = orbs[i];
    const r = o.orbitRadius;
    const ct = Math.cos(o.orbitTilt);
    const st = Math.sin(o.orbitTilt);
    const base = i * floatsPerOrb;
    for (let s = 0; s < SEGMENTS_PER_RING; s++) {
      const a0 = (s / SEGMENTS_PER_RING) * Math.PI * 2;
      const a1 = ((s + 1) / SEGMENTS_PER_RING) * Math.PI * 2;
      const x0 = r * Math.cos(a0);
      const z0raw = r * Math.sin(a0);
      const x1 = r * Math.cos(a1);
      const z1raw = r * Math.sin(a1);
      // Apply per-orb tilt around X (matches firefly vertex shader).
      const y0 = -st * z0raw;
      const z0 = ct * z0raw;
      const y1 = -st * z1raw;
      const z1 = ct * z1raw;
      const off = base + s * 6;
      positions[off + 0] = o.treeX + x0;
      positions[off + 1] = o.height + y0;
      positions[off + 2] = o.treeZ + z0;
      positions[off + 3] = o.treeX + x1;
      positions[off + 4] = o.height + y1;
      positions[off + 5] = o.treeZ + z1;
    }
  }

  const geometry = new LineSegmentsGeometry();
  geometry.setPositions(positions as unknown as number[]); // setPositions accepts ArrayLike<number>

  const material = new LineMaterial({
    color: new THREE.Color(cfg.ORBIT_RING_COLOR).getHex(),
    linewidth: cfg.ORBIT_RING_THICKNESS,
    transparent: true,
    opacity: cfg.ORBIT_RING_OPACITY,
    depthWrite: false,
    worldUnits: false, // pixel-space line width
  });
  // resolution will be updated via onResize(); set a sane default so
  // the initial render isn't broken before onResize fires.
  material.resolution.set(window.innerWidth || 1, window.innerHeight || 1);

  const mesh = new LineSegments2(geometry, material);
  mesh.frustumCulled = false;
  // computeLineDistances enables dashed lines if ever desired; not needed
  // for a solid line but the call is cheap and matches the addon idiom.
  mesh.computeLineDistances();

  group.add(mesh);

  return {
    group,
    refresh() {
      const next = FIREFLIES.get();
      material.color.set(next.ORBIT_RING_COLOR);
      material.opacity = next.ORBIT_RING_OPACITY;
      material.linewidth = next.ORBIT_RING_THICKNESS;
      group.visible = next.ORBIT_RING_ENABLED;
    },
    onResize(width: number, height: number) {
      material.resolution.set(width, height);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      group.remove(mesh);
    },
  };
}
