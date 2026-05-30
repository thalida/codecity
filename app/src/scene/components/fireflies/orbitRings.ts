// scene/fireflies/orbitRings.ts — selection/hover ring around the tree
// for the currently hovered + currently selected commits.
//
// Shape: two slots (hover + selected). Each slot owns N Meshes — one
// per author orb on the active commit — built lazily when commitIndex
// is non-null AND visible per the reconciliation rule. Multi-author
// commits emit multiple per-author orbits (different orbitRadius /
// orbitTilt per author); the slot renders one ring per orbit so a
// hovered 3-co-author tree shows all three orbits, not just one.
//
// Materials are allocated once per slot; only geometry is rebuilt on
// commit-change.
//
//   setHoveredCommit(idx):  update hover.commitIndex, reconcile.
//   setSelectedCommit(idx): update selected slot (and reconcile hover).
//   refresh():  reapply config colors to active slot materials.
//   dispose():  drop both slots' geometries + materials.

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
  /** Currently-rendered meshes — one per author orb on the active commit.
   *  Empty when the slot has no visible rings. Multi-author commits have
   *  multiple distinct orbits, each rendered as its own ring. */
  meshes: THREE.Mesh[];
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
  // Multiple orbs share a commitIndex on multi-author commits (one orb
  // per author), so the value is a list, not a single placement.
  const placementsByCommit = new Map<number, FireflyPlacement[]>();
  for (const orb of orbs) {
    let list = placementsByCommit.get(orb.commitIndex);
    if (!list) {
      list = [];
      placementsByCommit.set(orb.commitIndex, list);
    }
    list.push(orb);
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
    meshes: [],
    material: makeSlotMaterial(cfg.ORBIT_RING_HOVER_COLOR),
  };
  const selected: Slot = {
    commitIndex: null,
    meshes: [],
    material: makeSlotMaterial(cfg.ORBIT_RING_SELECTED_COLOR),
  };

  function disposeSlotMeshes(slot: Slot): void {
    for (const mesh of slot.meshes) {
      group.remove(mesh);
      mesh.geometry.dispose();
    }
    slot.meshes = [];
  }

  function buildSlotMeshes(slot: Slot, slotOrbs: FireflyPlacement[]): void {
    const thickness = FIREFLIES.get().ORBIT_RING_THICKNESS;
    for (const orb of slotOrbs) {
      const geom = buildTubeGeometry(orb, thickness);
      const mesh = new THREE.Mesh(geom, slot.material);
      mesh.frustumCulled = false;
      slot.meshes.push(mesh);
      group.add(mesh);
    }
  }

  /** The hover meshes should be visible iff hover is set AND distinct from selected. */
  function reconcileHoverMeshes(): void {
    const shouldShow = hover.commitIndex !== null && hover.commitIndex !== selected.commitIndex;

    if (!shouldShow) {
      disposeSlotMeshes(hover);
      return;
    }

    // hover.commitIndex is non-null per shouldShow.
    const slotOrbs = placementsByCommit.get(hover.commitIndex);
    if (!slotOrbs) {
      disposeSlotMeshes(hover);
      return;
    }
    disposeSlotMeshes(hover);
    buildSlotMeshes(hover, slotOrbs);
  }

  function setSelectedSlot(idx: number | null): void {
    if (selected.commitIndex === idx) return;
    selected.commitIndex = idx;
    disposeSlotMeshes(selected);
    if (idx === null) return;
    const slotOrbs = placementsByCommit.get(idx);
    if (!slotOrbs) return;
    buildSlotMeshes(selected, slotOrbs);
  }

  return {
    group,

    setHoveredCommit(commitIndex: number | null) {
      if (hover.commitIndex === commitIndex) return;
      hover.commitIndex = commitIndex;
      reconcileHoverMeshes();
    },

    setSelectedCommit(commitIndex: number | null) {
      setSelectedSlot(commitIndex);
      reconcileHoverMeshes();
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
      disposeSlotMeshes(hover);
      disposeSlotMeshes(selected);
      hover.material.dispose();
      selected.material.dispose();
      group.clear();
    },
  };
}
