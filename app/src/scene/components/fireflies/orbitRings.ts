// scene/fireflies/orbitRings.ts — subtle ring around each tree at the
// height + tilt of its firefly orbit.
//
// All rings are merged into ONE BufferGeometry / ONE Mesh (one draw call)
// with a per-vertex RGBA color attribute. Hover and select states write
// directly into the colour buffer for the affected ring's vertex range —
// no material swap, no extra draw calls.
//
//   setHoveredCommit(idx):  update the colour attribute for the hovered ring.
//   setSelectedCommit(idx): update the colour attribute for the selected ring.
//   refresh():  rewrite all vertex ranges with the current config colours.
//   dispose():  clean up the merged geometry + material.

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

interface RingRange {
  /** First vertex index in the merged colour array. */
  vertexStart: number;
  /** Number of vertices for this ring. */
  vertexCount: number;
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

  // Build each per-orb TubeGeometry, then merge their position/normal/index
  // attributes into a single BufferGeometry. Track per-ring vertex ranges.
  const rangeByCommit = new Map<number, RingRange>();
  const positionArrays: Float32Array[] = [];
  const normalArrays: Float32Array[] = [];
  const indexArrays: Uint32Array[] = [];
  let totalVerts = 0;
  let totalIndices = 0;
  const perGeometries: THREE.TubeGeometry[] = [];

  for (let i = 0; i < orbs.length; i++) {
    const o = orbs[i];
    const path = new TiltedCirclePath(
      new THREE.Vector3(o.treeX, o.height, o.treeZ),
      o.orbitRadius,
      o.orbitTilt
    );
    const tube = new THREE.TubeGeometry(
      path,
      TUBULAR_SEGMENTS,
      cfg.ORBIT_RING_THICKNESS,
      RADIAL_SEGMENTS,
      true // closed
    );
    perGeometries.push(tube);

    const posAttr = tube.getAttribute('position');
    const nrmAttr = tube.getAttribute('normal');
    const idxAttr = tube.getIndex();
    if (!posAttr || !nrmAttr || !idxAttr) continue;
    const vertCount = posAttr.count;
    const indCount = idxAttr.count;

    const posCopy = new Float32Array(posAttr.array as ArrayLike<number>).slice();
    const nrmCopy = new Float32Array(nrmAttr.array as ArrayLike<number>).slice();
    const idxCopy = new Uint32Array(indCount);
    const srcIdx = idxAttr.array as ArrayLike<number>;
    for (let k = 0; k < indCount; k++) idxCopy[k] = (srcIdx[k] as number) + totalVerts;

    positionArrays.push(posCopy);
    normalArrays.push(nrmCopy);
    indexArrays.push(idxCopy);

    rangeByCommit.set(o.commitIndex, { vertexStart: totalVerts, vertexCount: vertCount });
    totalVerts += vertCount;
    totalIndices += indCount;
  }

  // Allocate combined buffers.
  const combinedPos = new Float32Array(totalVerts * 3);
  const combinedNrm = new Float32Array(totalVerts * 3);
  const combinedIdx = new Uint32Array(totalIndices);
  const combinedColor = new Float32Array(totalVerts * 4);
  let vOffset = 0;
  let iOffset = 0;
  for (let i = 0; i < positionArrays.length; i++) {
    combinedPos.set(positionArrays[i], vOffset * 3);
    combinedNrm.set(normalArrays[i], vOffset * 3);
    combinedIdx.set(indexArrays[i], iOffset);
    vOffset += positionArrays[i].length / 3;
    iOffset += indexArrays[i].length;
  }

  // Fill the colour attribute with the default RGBA for every vertex.
  const defaultColor = new THREE.Color(cfg.ORBIT_RING_COLOR);
  for (let v = 0; v < totalVerts; v++) {
    combinedColor[v * 4 + 0] = defaultColor.r;
    combinedColor[v * 4 + 1] = defaultColor.g;
    combinedColor[v * 4 + 2] = defaultColor.b;
    combinedColor[v * 4 + 3] = cfg.ORBIT_RING_OPACITY;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(combinedPos, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(combinedNrm, 3));
  const colorAttr = new THREE.BufferAttribute(combinedColor, 4);
  colorAttr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('color', colorAttr);
  geometry.setIndex(new THREE.BufferAttribute(combinedIdx, 1));

  // Free intermediate per-tube geometries — their data is now in combined arrays.
  for (const g of perGeometries) g.dispose();

  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
    // Per-vertex alpha is carried in the colour attribute (itemSize 4).
    // The material opacity is fixed at 1 so the alpha channel from the
    // colour buffer is used directly by the renderer.
    opacity: 1.0,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.name = 'firefly-orbit-rings-merged';
  group.add(mesh);

  // Track hover / selected commit indices for refresh() and state transitions.
  let currentHoveredCommit: number | null = null;
  let currentSelectedCommit: number | null = null;

  function writeRangeRGBA(range: RingRange, r: number, g: number, b: number, a: number): void {
    for (let v = 0; v < range.vertexCount; v++) {
      const i = (range.vertexStart + v) * 4;
      combinedColor[i + 0] = r;
      combinedColor[i + 1] = g;
      combinedColor[i + 2] = b;
      combinedColor[i + 3] = a;
    }
    colorAttr.needsUpdate = true;
  }

  function applyDefaultTo(range: RingRange): void {
    const c = new THREE.Color(FIREFLIES.get().ORBIT_RING_COLOR);
    writeRangeRGBA(range, c.r, c.g, c.b, FIREFLIES.get().ORBIT_RING_OPACITY);
  }

  function applyHoverTo(range: RingRange): void {
    const c = new THREE.Color(FIREFLIES.get().ORBIT_RING_HOVER_COLOR);
    writeRangeRGBA(range, c.r, c.g, c.b, 1.0);
  }

  function applySelectedTo(range: RingRange): void {
    const c = new THREE.Color(FIREFLIES.get().ORBIT_RING_SELECTED_COLOR);
    writeRangeRGBA(range, c.r, c.g, c.b, 1.0);
  }

  return {
    group,

    setHoveredCommit(commitIndex: number | null) {
      // Restore previous hover (if not selected).
      if (currentHoveredCommit !== null && currentHoveredCommit !== commitIndex) {
        const prevRange = rangeByCommit.get(currentHoveredCommit);
        if (prevRange && currentHoveredCommit !== currentSelectedCommit) {
          applyDefaultTo(prevRange);
        }
      }
      currentHoveredCommit = commitIndex;
      if (commitIndex !== null && commitIndex !== currentSelectedCommit) {
        const range = rangeByCommit.get(commitIndex);
        if (range) applyHoverTo(range);
      }
    },

    setSelectedCommit(commitIndex: number | null) {
      if (currentSelectedCommit !== null && currentSelectedCommit !== commitIndex) {
        const prevRange = rangeByCommit.get(currentSelectedCommit);
        if (prevRange) {
          if (currentSelectedCommit === currentHoveredCommit) {
            applyHoverTo(prevRange);
          } else {
            applyDefaultTo(prevRange);
          }
        }
      }
      currentSelectedCommit = commitIndex;
      if (commitIndex !== null) {
        const range = rangeByCommit.get(commitIndex);
        if (range) applySelectedTo(range);
      }
    },

    refresh() {
      const next = FIREFLIES.get();
      group.visible = next.ORBIT_RING_ENABLED;
      // Rewrite ALL ranges with the current default colour/opacity, then
      // re-apply hover + selected so they keep their highlight colours.
      for (const [commit, range] of rangeByCommit.entries()) {
        if (commit === currentSelectedCommit) {
          applySelectedTo(range);
        } else if (commit === currentHoveredCommit) {
          applyHoverTo(range);
        } else {
          applyDefaultTo(range);
        }
      }
    },

    onResize() {
      // Tube-based rings have no screen-space uniforms; no-op.
    },

    dispose() {
      geometry.dispose();
      material.dispose();
      group.clear();
    },
  };
}
