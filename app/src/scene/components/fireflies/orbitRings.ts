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
// Coloring:
//   • Hover slot — each mesh gets its OWN MeshBasicMaterial colored as
//     that orb's `lightRgb` (pastel of the author's firefly hue). A
//     hovered 3-co-author tree shows three orbits in three pastel tints.
//   • Selected slot — one shared MeshBasicMaterial with
//     vertexColors: true. Each TubeGeometry carries a `color` attribute
//     that update(timeMs) rewrites every frame to produce the shared
//     RAINBOW chase used by the tree-canopy outline.
//
//   setHoveredCommit(idx):  update hover.commitIndex, reconcile.
//   setSelectedCommit(idx): update selected slot (and reconcile hover).
//   update(timeMs):  advance the selected-slot rainbow chase.
//   refresh():  re-read FIREFLIES.ORBIT_RING_ENABLED visibility.
//   dispose():  drop both slots' geometries + materials.

import * as THREE from 'three';
import { FIREFLIES } from '@/state/settings/components/fireflies';
import { RAINBOW } from '@/state/settings/effects/effects';
import type { FireflyPlacement } from './firefliesPlacement';

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
   * Advance the rainbow chase on selected rings. `timeMs` matches the
   * tree-outline renderer's convention: `performance.now()` (milliseconds).
   * Cheap no-op when no selected meshes exist.
   */
  update(timeMs: number): void;
  /**
   * Reapply current config to the active slots. Note: ORBIT_RING_THICKNESS
   * is baked into geometry, so a thickness change only takes effect on
   * the next slot rebuild. ORBIT_RING_ENABLED visibility is honored here.
   */
  refresh(): void;
  /** No-op for tube-based rings; kept for interface symmetry. */
  onResize(width: number, height: number): void;
  dispose(): void;
}

interface HoverSlot {
  /** Logical state: what commit this slot tracks (independent of visibility). */
  commitIndex: number | null;
  /** Currently-rendered meshes — one per author orb on the active commit.
   *  Each mesh owns its own pastel-colored MeshBasicMaterial. */
  meshes: THREE.Mesh[];
}

interface SelectedSlot {
  commitIndex: number | null;
  /** Currently-rendered meshes — one per author orb on the active commit.
   *  All share a single vertexColors: true material; per-mesh color is in
   *  the geometry's `color` attribute, rewritten every frame. */
  meshes: THREE.Mesh[];
  /** Shared material for all selected meshes — vertexColors: true so the
   *  per-vertex rainbow buffer takes effect. */
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

/** Allocate a vertexCount × 3 `color` attribute on `geom` if it's missing.
 *  Returns the underlying Float32Array so callers can mutate in place. */
function ensureColorBuffer(geom: THREE.BufferGeometry): Float32Array {
  let attr = geom.getAttribute('color') as THREE.BufferAttribute | undefined;
  if (!attr) {
    const vertexCount = (geom.getAttribute('position') as THREE.BufferAttribute).count;
    const buf = new Float32Array(vertexCount * 3);
    attr = new THREE.BufferAttribute(buf, 3);
    geom.setAttribute('color', attr);
  }
  return attr.array as Float32Array;
}

const _rainbowTmpColor = new THREE.Color();

/** Write the per-frame rainbow chase into a TubeGeometry's `color` buffer.
 *  TubeGeometry vertex ordering is (tubularSegments + 1) × (radialSegments + 1),
 *  indexed as `j * radialSlices + i` where j is the tubular slice and i
 *  is the cross-section slice. All vertices on a given tubular slice share
 *  the same hue so the chase rotates smoothly along the ring. */
function writeRainbowToTube(mesh: THREE.Mesh, timeMs: number): void {
  const geom = mesh.geometry as THREE.BufferGeometry;
  const buf = ensureColorBuffer(geom);
  const rb = RAINBOW.get();
  // Match treeOutlineRenderer's convention: t = performance.now() * SPEED,
  // where SPEED is hue cycles per millisecond.
  const t = timeMs * rb.SPEED;
  const tubularSlices = TUBULAR_SEGMENTS + 1;
  const radialSlices = RADIAL_SEGMENTS + 1;
  for (let j = 0; j < tubularSlices; j++) {
    const hue = (((t + j / TUBULAR_SEGMENTS) % 1) + 1) % 1;
    _rainbowTmpColor.setHSL(hue, rb.SATURATION, rb.LIGHTNESS);
    for (let i = 0; i < radialSlices; i++) {
      const vertexIdx = j * radialSlices + i;
      const k = vertexIdx * 3;
      buf[k] = _rainbowTmpColor.r;
      buf[k + 1] = _rainbowTmpColor.g;
      buf[k + 2] = _rainbowTmpColor.b;
    }
  }
  const attr = geom.getAttribute('color') as THREE.BufferAttribute;
  attr.needsUpdate = true;
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
      update() {},
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

  /** Per-mesh material for hover rings — each tinted as that author's
   *  pastel hue. Allocated and disposed lazily with the mesh. */
  function makeHoverMaterial(lightRgb: [number, number, number]): THREE.MeshBasicMaterial {
    const mat = new THREE.MeshBasicMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    // lightRgb is linear-RGB (0..1). Bypass three.js' working-color-space
    // conversion so the OKLCH→linear math we did upstream isn't double-gamma'd.
    mat.color.setRGB(lightRgb[0], lightRgb[1], lightRgb[2], THREE.LinearSRGBColorSpace);
    return mat;
  }

  /** Shared material for selected rings — vertexColors: true so the
   *  per-vertex rainbow buffer drives the chase. */
  const selectedMaterial = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });

  const hover: HoverSlot = {
    commitIndex: null,
    meshes: [],
  };
  const selected: SelectedSlot = {
    commitIndex: null,
    meshes: [],
    material: selectedMaterial,
  };

  function disposeHoverMeshes(): void {
    for (const mesh of hover.meshes) {
      group.remove(mesh);
      mesh.geometry.dispose();
      // Each hover mesh owns its own material.
      (mesh.material as THREE.MeshBasicMaterial).dispose();
    }
    hover.meshes = [];
  }

  function disposeSelectedMeshes(): void {
    for (const mesh of selected.meshes) {
      group.remove(mesh);
      mesh.geometry.dispose();
      // Selected meshes share `selectedMaterial` — don't dispose here.
    }
    selected.meshes = [];
  }

  function buildHoverMeshes(slotOrbs: FireflyPlacement[]): void {
    const thickness = FIREFLIES.get().ORBIT_RING_THICKNESS;
    for (const orb of slotOrbs) {
      const geom = buildTubeGeometry(orb, thickness);
      const mat = makeHoverMaterial(orb.lightRgb);
      const mesh = new THREE.Mesh(geom, mat);
      mesh.frustumCulled = false;
      hover.meshes.push(mesh);
      group.add(mesh);
    }
  }

  function buildSelectedMeshes(slotOrbs: FireflyPlacement[]): void {
    const thickness = FIREFLIES.get().ORBIT_RING_THICKNESS;
    for (const orb of slotOrbs) {
      const geom = buildTubeGeometry(orb, thickness);
      // Pre-allocate the color attribute so the renderer sees it on the
      // very first frame; update() will populate it before the next render.
      ensureColorBuffer(geom);
      const mesh = new THREE.Mesh(geom, selected.material);
      mesh.frustumCulled = false;
      selected.meshes.push(mesh);
      group.add(mesh);
    }
  }

  /** The hover meshes should be visible iff hover is set AND distinct from selected. */
  function reconcileHoverMeshes(): void {
    const shouldShow = hover.commitIndex !== null && hover.commitIndex !== selected.commitIndex;

    if (!shouldShow) {
      disposeHoverMeshes();
      return;
    }

    // hover.commitIndex is non-null per shouldShow.
    const slotOrbs = placementsByCommit.get(hover.commitIndex!);
    if (!slotOrbs) {
      disposeHoverMeshes();
      return;
    }
    disposeHoverMeshes();
    buildHoverMeshes(slotOrbs);
  }

  function setSelectedSlot(idx: number | null): void {
    if (selected.commitIndex === idx) return;
    selected.commitIndex = idx;
    disposeSelectedMeshes();
    if (idx === null) return;
    const slotOrbs = placementsByCommit.get(idx);
    if (!slotOrbs) return;
    buildSelectedMeshes(slotOrbs);
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

    update(timeMs: number) {
      if (selected.meshes.length === 0) return;
      for (const mesh of selected.meshes) {
        writeRainbowToTube(mesh, timeMs);
      }
    },

    refresh() {
      const next = FIREFLIES.get();
      group.visible = next.ORBIT_RING_ENABLED;
    },

    onResize() {},

    dispose() {
      disposeHoverMeshes();
      disposeSelectedMeshes();
      selectedMaterial.dispose();
      group.clear();
    },
  };
}
