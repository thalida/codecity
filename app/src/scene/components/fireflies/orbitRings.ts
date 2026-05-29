// scene/fireflies/orbitRings.ts — selection/hover ring around the tree
// for the currently hovered + currently selected commits.
//
// New shape: two slots (hover + selected). Each slot owns one Mesh
// built lazily when its commitIndex is non-null AND visible per the
// reconciliation rule. Materials are allocated once per slot; only
// geometry is rebuilt on commit-change.
//
//   setHoveredCommit(idx):  update hover.commitIndex, reconcile.
//   setSelectedCommit(idx): update selected slot (and reconcile hover).
//   refresh():  reapply config colors to active slot materials.
//   dispose():  drop both slot geometries + materials.

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
  /**
   * Reapply current config colors to active slot materials. Note:
   * ORBIT_RING_THICKNESS is baked into geometry, so a thickness change
   * only takes effect on the next slot rebuild (i.e. next hover/select
   * change), not on this refresh() call.
   */
  refresh(): void;
  /** No-op for tube-based rings; kept for interface symmetry. */
  onResize(width: number, height: number): void;
  dispose(): void;
}

interface Slot {
  /** Logical state: what commit this slot tracks (independent of visibility). */
  commitIndex: number | null;
  /** The currently-rendered mesh, or null if the slot has no visible ring. */
  mesh: THREE.Mesh | null;
  /** Pre-allocated material for this slot. Color is updated on refresh(). */
  material: THREE.MeshBasicMaterial;
}

function buildTubeGeometry(orb: FireflyPlacement, thickness: number): THREE.TubeGeometry {
  const path = new TiltedCirclePath(
    new THREE.Vector3(orb.treeX, orb.height, orb.treeZ),
    orb.orbitRadius,
    orb.orbitTilt
  );
  return new THREE.TubeGeometry(path, TUBULAR_SEGMENTS, thickness, RADIAL_SEGMENTS, true);
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

  // Build the placement lookup once. Pure pointer work — no geometry.
  const placementByCommit = new Map<number, FireflyPlacement>();
  for (const orb of orbs) {
    placementByCommit.set(orb.commitIndex, orb);
  }

  function makeSlotMaterial(color: string): THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial({
      color,
      // Match the firefly orbs' transparent pass; depthWrite: false keeps
      // the ring from punching depth into the trees behind it.
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
  }

  const hover: Slot = {
    commitIndex: null,
    mesh: null,
    material: makeSlotMaterial(cfg.ORBIT_RING_HOVER_COLOR),
  };
  const selected: Slot = {
    commitIndex: null,
    mesh: null,
    material: makeSlotMaterial(cfg.ORBIT_RING_SELECTED_COLOR),
  };

  function disposeSlotMesh(slot: Slot): void {
    if (slot.mesh) {
      group.remove(slot.mesh);
      slot.mesh.geometry.dispose();
      slot.mesh = null;
    }
  }

  function buildSlotMesh(slot: Slot, orb: FireflyPlacement): void {
    const geom = buildTubeGeometry(orb, FIREFLIES.get().ORBIT_RING_THICKNESS);
    const mesh = new THREE.Mesh(geom, slot.material);
    mesh.frustumCulled = false;
    slot.mesh = mesh;
    group.add(mesh);
  }

  /** The hover mesh should be visible iff hover is set AND distinct from selected. */
  function reconcileHoverMesh(): void {
    const shouldShow =
      hover.commitIndex !== null && hover.commitIndex !== selected.commitIndex;

    if (!shouldShow) {
      disposeSlotMesh(hover);
      return;
    }

    // hover.commitIndex is non-null per shouldShow.
    const orb = placementByCommit.get(hover.commitIndex);
    if (!orb) {
      disposeSlotMesh(hover);
      return;
    }
    disposeSlotMesh(hover);
    buildSlotMesh(hover, orb);
  }

  function setSelectedSlot(idx: number | null): void {
    if (selected.commitIndex === idx) return;
    selected.commitIndex = idx;
    disposeSlotMesh(selected);
    if (idx === null) return;
    const orb = placementByCommit.get(idx);
    if (!orb) return;
    buildSlotMesh(selected, orb);
  }

  return {
    group,

    setHoveredCommit(commitIndex: number | null) {
      if (hover.commitIndex === commitIndex) return;
      hover.commitIndex = commitIndex;
      reconcileHoverMesh();
    },

    setSelectedCommit(commitIndex: number | null) {
      setSelectedSlot(commitIndex);
      reconcileHoverMesh();
    },

    refresh() {
      const next = FIREFLIES.get();
      group.visible = next.ORBIT_RING_ENABLED;
      hover.material.color.set(next.ORBIT_RING_HOVER_COLOR);
      selected.material.color.set(next.ORBIT_RING_SELECTED_COLOR);
      hover.material.needsUpdate = true;
      selected.material.needsUpdate = true;
    },

    onResize() {},

    dispose() {
      disposeSlotMesh(hover);
      disposeSlotMesh(selected);
      hover.material.dispose();
      selected.material.dispose();
      group.clear();
    },
  };
}
