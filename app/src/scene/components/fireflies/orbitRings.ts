// scene/fireflies/orbitRings.ts — subtle ring around each tree at the
// height + tilt of its firefly orbit. Each ring is one Line2 (continuous
// polyline) so the segment joints don't show as visible "dots" — a
// LineSegments2-based approach renders rounded caps at every joint
// where two segments meet, producing a dotted appearance. Line2 only
// caps the start and end of the polyline.
//
// One Line2 per orb. All share a single LineMaterial so refresh()
// updates color/opacity/linewidth in one place.
//
//   refresh():  hot-reload color + opacity + thickness from current config.
//   dispose():  clean up geometries (per-orb) + the shared material.

import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
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

  // Shared material — one for all rings; refresh() updates this single
  // instance and every Line2 picks up the change.
  const material = new LineMaterial({
    color: new THREE.Color(cfg.ORBIT_RING_COLOR).getHex(),
    linewidth: cfg.ORBIT_RING_THICKNESS,
    transparent: true,
    opacity: cfg.ORBIT_RING_OPACITY,
    depthWrite: false,
    worldUnits: false, // pixel-space line width
  });
  // Resolution updated via onResize(); set a sane default so the initial
  // render isn't broken before onResize fires.
  material.resolution.set(window.innerWidth || 1, window.innerHeight || 1);

  // Per-orb: build a closed polyline (first point repeated at end) and
  // attach a Line2 to the group. Sharing the material across all rings
  // keeps draw-state changes minimal.
  const pointCount = SEGMENTS_PER_RING + 1; // +1 closes the loop
  const geometries: LineGeometry[] = [];
  for (let i = 0; i < orbs.length; i++) {
    const o = orbs[i];
    const r = o.orbitRadius;
    const ct = Math.cos(o.orbitTilt);
    const st = Math.sin(o.orbitTilt);
    const points = new Float32Array(pointCount * 3);
    for (let s = 0; s <= SEGMENTS_PER_RING; s++) {
      const a = (s / SEGMENTS_PER_RING) * Math.PI * 2;
      const x = r * Math.cos(a);
      const zRaw = r * Math.sin(a);
      // Apply per-orb tilt around X (matches firefly vertex shader).
      const y = -st * zRaw;
      const z = ct * zRaw;
      points[s * 3 + 0] = o.treeX + x;
      points[s * 3 + 1] = o.height + y;
      points[s * 3 + 2] = o.treeZ + z;
    }
    const geometry = new LineGeometry();
    geometry.setPositions(points as unknown as number[]);
    geometries.push(geometry);

    const ring = new Line2(geometry, material);
    ring.frustumCulled = false;
    ring.computeLineDistances();
    group.add(ring);
  }

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
      for (const g of geometries) g.dispose();
      material.dispose();
      group.clear();
    },
  };
}
