// scene/fireflies/orbitRings.ts — subtle ring around each tree at the
// height + tilt of its firefly orbit.
//
// Renders each ring as a TubeGeometry around a circular CurvePath in
// the firefly's tilted orbital plane. The tube has a CONSTANT world-
// unit radius across all rings (independent of orbital radius), so
// every ring is the same physical thickness. Continuous mesh — no
// per-segment shader, no rounded caps, no dot artifacts at joints.
//
// Three materials are maintained:
//   defaultMaterial  — dim, low-opacity resting state.
//   hoverMaterial    — bright white (configurable), fully opaque.
//   selectedMaterial — gold (configurable), fully opaque. Beats hover.
//
// A meshByCommit map lets setHoveredCommit / setSelectedCommit swap the
// material on the one affected mesh without touching any other.
//
//   setHoveredCommit(idx):  swap ring material for the hovered tree.
//   setSelectedCommit(idx): swap ring material for the selected tree.
//   refresh():  hot-reload color + opacity from current config.
//   dispose():  clean up geometries (per-orb) + all three materials.

import * as THREE from 'three';
import { FIREFLIES } from '@/config/components/fireflies.js';
import type { FireflyPlacement } from './firefliesPlacement.js';

const TUBULAR_SEGMENTS = 96; // segments around the loop
const RADIAL_SEGMENTS = 6; // segments around the tube's cross-section

/** Closed circular path in a plane tilted by `tilt` radians around the X axis. */
class TiltedCirclePath extends THREE.Curve<THREE.Vector3> {
  constructor(
    public center: THREE.Vector3,
    public radius: number,
    public tilt: number
  ) {
    super();
  }

  override getPoint(t: number, target = new THREE.Vector3()): THREE.Vector3 {
    const a = t * Math.PI * 2;
    const x = this.radius * Math.cos(a);
    const zRaw = this.radius * Math.sin(a);
    // Per-orb tilt around X (matches firefly vertex shader).
    const ct = Math.cos(this.tilt);
    const st = Math.sin(this.tilt);
    const y = -st * zRaw;
    const z = ct * zRaw;
    return target.set(this.center.x + x, this.center.y + y, this.center.z + z);
  }
}

export interface OrbitRings {
  group: THREE.Group;
  /** Highlight the ring for the given commitIndex as hovered. Pass null to clear. */
  setHoveredCommit(commitIndex: number | null): void;
  /** Highlight the ring for the given commitIndex as selected. Pass null to clear. */
  setSelectedCommit(commitIndex: number | null): void;
  refresh(): void;
  /** No-op for tube-based rings; kept for interface symmetry. */
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
      setHoveredCommit() {},
      setSelectedCommit() {},
      refresh() {},
      onResize() {},
      dispose() {},
    };
  }

  // Shared material props (other than color/opacity).
  const sharedProps = {
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  } as const;

  const defaultMaterial = new THREE.MeshBasicMaterial({
    ...sharedProps,
    color: new THREE.Color(cfg.ORBIT_RING_COLOR),
    opacity: cfg.ORBIT_RING_OPACITY,
  });

  const hoverMaterial = new THREE.MeshBasicMaterial({
    ...sharedProps,
    color: new THREE.Color(cfg.ORBIT_RING_HOVER_COLOR),
    opacity: 1.0,
  });

  const selectedMaterial = new THREE.MeshBasicMaterial({
    ...sharedProps,
    color: new THREE.Color(cfg.ORBIT_RING_SELECTED_COLOR),
    opacity: 1.0,
  });

  // commitIndex → mesh lookup so hover/select swaps are O(1).
  const meshByCommit = new Map<number, THREE.Mesh>();

  const tubeRadius = cfg.ORBIT_RING_THICKNESS;
  const geometries: THREE.BufferGeometry[] = [];
  for (let i = 0; i < orbs.length; i++) {
    const o = orbs[i];
    const path = new TiltedCirclePath(
      new THREE.Vector3(o.treeX, o.height, o.treeZ),
      o.orbitRadius,
      o.orbitTilt
    );
    const geometry = new THREE.TubeGeometry(
      path,
      TUBULAR_SEGMENTS,
      tubeRadius,
      RADIAL_SEGMENTS,
      true // closed
    );
    geometries.push(geometry);

    const mesh = new THREE.Mesh(geometry, defaultMaterial);
    mesh.frustumCulled = false;
    group.add(mesh);

    meshByCommit.set(o.commitIndex, mesh);
  }

  // Track which mesh is currently in each highlight state.
  let currentHoveredMesh: THREE.Mesh | null = null;
  let currentSelectedMesh: THREE.Mesh | null = null;

  return {
    group,

    setHoveredCommit(commitIndex: number | null) {
      const newMesh = commitIndex !== null ? (meshByCommit.get(commitIndex) ?? null) : null;

      // Restore the previously hovered mesh if it has changed.
      if (currentHoveredMesh !== null && currentHoveredMesh !== newMesh) {
        // Only restore to default if it is not the currently selected mesh.
        if (currentHoveredMesh !== currentSelectedMesh) {
          currentHoveredMesh.material = defaultMaterial;
        }
      }

      currentHoveredMesh = newMesh;

      if (newMesh !== null) {
        // Selected wins — don't downgrade a selected ring to hover.
        if (newMesh !== currentSelectedMesh) {
          newMesh.material = hoverMaterial;
        }
      }
    },

    setSelectedCommit(commitIndex: number | null) {
      const newMesh = commitIndex !== null ? (meshByCommit.get(commitIndex) ?? null) : null;

      // Restore the previously selected mesh.
      if (currentSelectedMesh !== null && currentSelectedMesh !== newMesh) {
        // Restore to hover material if still hovered, otherwise default.
        currentSelectedMesh.material =
          currentSelectedMesh === currentHoveredMesh ? hoverMaterial : defaultMaterial;
      }

      currentSelectedMesh = newMesh;

      if (newMesh !== null) {
        newMesh.material = selectedMaterial;
      }
    },

    refresh() {
      const next = FIREFLIES.get();
      defaultMaterial.color.set(next.ORBIT_RING_COLOR);
      defaultMaterial.opacity = next.ORBIT_RING_OPACITY;
      hoverMaterial.color.set(next.ORBIT_RING_HOVER_COLOR);
      selectedMaterial.color.set(next.ORBIT_RING_SELECTED_COLOR);
      // hover/selected opacity stays at 1.0 (not user-configurable for v1).
      group.visible = next.ORBIT_RING_ENABLED;
      // Note: ORBIT_RING_THICKNESS changes require a rebuild (tube
      // radius is baked into geometry). The structural-rebuild path in
      // configCommitReactions handles that.
    },

    onResize() {
      // Tube-based rings have no screen-space uniforms; no-op.
    },

    dispose() {
      for (const g of geometries) g.dispose();
      defaultMaterial.dispose();
      hoverMaterial.dispose();
      selectedMaterial.dispose();
      group.clear();
    },
  };
}
