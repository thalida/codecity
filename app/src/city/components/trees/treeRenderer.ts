// city/components/trees/treeRenderer.ts — turns a TreePlacement[] + the manifest's
// commit list into chunked canopy + trunk InstancedMeshes (instanceChunkSize
// instances per mesh; one giant draw corrupts on some mobile drivers).
//
//   tree-canopy — low-poly lathe canopies at a single shared facet count
//                 (TREE_CANOPY_FACETS), stretched to the per-tree (radius,
//                 height) by the instance matrix.
//   tree-trunk  — round cylinder, one instance per tree. Y scale
//                 = TRUNK_HEIGHT_FRAC × canopy height; XZ scale
//                 = TRUNK_RADIUS_FRAC × canopy radius.
//
// Canopy geometries carry a baked per-vertex color attribute combining
// a vertical gradient (dark base → light top) and a directional face
// shade (vertex normal dotted with a fixed pseudo-light), which gives
// every facet of the low-poly oval a distinct brightness without any
// runtime lighting.
//
// `refresh()` rewrites per-instance color attributes + visibility +
// trunk color from TREES without rebuilding the meshes. Anything that
// changes geometry sizes (height/width range, trunk fractions, shading
// strength) goes through the rebuild path in state/settingsReactions.ts.

import * as THREE from 'three';
import { TREES } from '@/state/stores/settings/trees';
import { RENDER_ORDERS } from '@/city/types/renderOrders';
import type { TreePlacement } from './treePlacement';
import type { CommitEntry, BusynessThresholds, RepoStats } from '@/types';
import {
  computeAgeRange,
  computeSizeRange,
  dailyCountTByIndex,
  treeHeight,
  treeRadius,
  type AgeRange,
  type SizeRange,
} from './treeEncoding';
import { interpolateOklch } from '@/city/utils/color/colors';
import { setColorFromHex } from '@/city/utils/color/setColorFromHex';
import { instanceChunkSize } from '@/city/utils/instanceChunkSize';
import { NEUTRAL_POLYGON_OFFSET } from '@/city/utils/neutralPolygonOffset';
import { sunDir } from '@/city/utils/shaders/sunDir';
import { LIGHTING_SUN_AZIMUTH_DEG, LIGHTING_SUN_ELEVATION_DEG } from '@/constants/lighting';

export interface Trees {
  group: THREE.Group;
  refresh(): void;
  dispose(): void;
  /** Resolve an InstancedMesh hit back to the commit that placed the
   *  hit's instance. Returns null if the mesh isn't one of the tree
   *  meshes on this group, the instanceId is out of range, or the
   *  underlying placement has no valid commit. */
  commitForInstance(mesh: THREE.InstancedMesh, instanceId: number): CommitEntry | null;
  /** Resolve a commit SHA to the first canopy instance rendering that
   *  commit's tree. Used by the picker to re-resolve a selection-by-sha
   *  across world rebuilds. Returns null when no tree on this group has
   *  the given sha. */
  findTreeBySha(sha: string): {
    mesh: THREE.InstancedMesh;
    instanceId: number;
    commit: CommitEntry;
  } | null;
  /** Read the baked canopy instanceColor for the given SHA directly from
   *  the InstancedMesh that renders it. Returns a CSS hex string (e.g.
   *  "#5e8a3a") or null when the sha can't be found. */
  colorForSha(sha: string): string | null;
  /** Write the canopy instance matrix for `sha` into `out`. Returns true
   *  when a tree was found, false otherwise. Used by treeOutlineRenderer
   *  to snap the hover/selected outline mesh's transform to the active
   *  tree without an extra Matrix4 allocation per frame. */
  getInstanceTransform(sha: string, out: THREE.Matrix4): boolean;
  /** Look up a tree's world position and dimensions by commit SHA.
   *  Returns null for an unknown sha, or when commits is null. The (x, z)
   *  are the tree's XZ position; y is the base (always 0). height is the
   *  trunk-top to canopy-top distance; radius is the canopy XZ radius. */
  getTreeBoundsBySha(sha: string): {
    x: number;
    y: number;
    z: number;
    height: number;
    radius: number;
  } | null;
  /** Timeline scrub gate: null shows every tree at full scale (live/no-scrub).
   *  A number zero-scales every tree whose placement.commitIndex exceeds it,
   *  restoring the cached full matrix for the rest — no rebuild, no per-tree
   *  visibility API needed since InstancedMesh has none. */
  setScrubCommit(maxCommitIndex: number | null): void;
}

/** Radial segment count for every canopy LatheGeometry — one shared value
 *  for all trees (not file-driven). Bump for rounder crowns, drop for a
 *  chunkier low-poly look. */
const TREE_CANOPY_FACETS = 6;

/** Lathe control points for the canopy silhouette: hand-picked (radius, height)
 *  pairs producing a round, near-spherical crown — widest at the middle (~y 0.5)
 *  and tapering symmetrically to rounded poles at top + bottom, so it reads as a
 *  ball rather than an elongated/popsicle column. Bottom→top, both axes
 *  normalized to [0,1] so one profile drives the canopy at any scale. Shared by
 *  `buildCanopyGeometry` (the rendered canopy) and `buildCanopyEdges` (the
 *  outline wireframe) — keep these two in sync. */
const CANOPY_PROFILE: readonly THREE.Vector2[] = [
  new THREE.Vector2(0, 0),
  new THREE.Vector2(0.42, 0.03),
  new THREE.Vector2(0.72, 0.1),
  new THREE.Vector2(0.9, 0.2),
  new THREE.Vector2(0.99, 0.32),
  new THREE.Vector2(1.0, 0.5),
  new THREE.Vector2(0.99, 0.68),
  new THREE.Vector2(0.9, 0.8),
  new THREE.Vector2(0.72, 0.9),
  new THREE.Vector2(0.42, 0.97),
  new THREE.Vector2(0.18, 0.995),
  new THREE.Vector2(0, 1.0),
];

/** Build a unit-height (Y ∈ [0,1]), unit-radius round canopy geometry.
 *
 *  Profile (lathed around the Y axis) is a near-sphere: widest at the
 *  middle, curving symmetrically in to rounded poles top + bottom, so the
 *  crown reads as a ball. It still converges to the axis at both poles (a
 *  lathe profile must), but the convex sides keep it round rather than the
 *  straight-sided, domed-top "popsicle" a wide-column profile produces. The
 *  trunk pokes up into the rounded underside.
 *
 *  Profile max X = 1.0, so when the renderer applies XZ scale = r, the
 *  canopy world radius at its widest = r exactly; with height ≈ 2r the crown
 *  renders as a circle, taller trees as a vertical ellipsoid. */
function buildCanopyGeometry(): THREE.BufferGeometry {
  const profile = CANOPY_PROFILE as THREE.Vector2[];
  const geom = new THREE.LatheGeometry(profile, TREE_CANOPY_FACETS);
  // Non-indexed + flat normals so the baked per-vertex shading reads
  // as discrete facets (each face shaded uniformly).
  const flat = geom.toNonIndexed();
  geom.dispose();
  flat.computeVertexNormals();
  return flat;
}

/** Build a clean wireframe `EdgesGeometry` for the canopy silhouette. Uses
 *  the SAME profile + segment count as `buildCanopyGeometry`, but on the
 *  indexed lathe (no `toNonIndexed`) so adjacent triangles share vertex
 *  normals — that lets `EdgesGeometry` collapse coplanar interior edges and
 *  emit only the ring boundaries.
 *
 *  Consumed by `./outline.ts` (the tree outline renderer). */
export function buildCanopyEdges(): THREE.EdgesGeometry {
  const lathe = new THREE.LatheGeometry(CANOPY_PROFILE as THREE.Vector2[], TREE_CANOPY_FACETS);
  // Default 1° threshold keeps any edge whose adjacent face normals differ
  // by >1° — for the canopy this means ring boundaries (profile slope
  // changes) plus the lathe's wrap seam. The result reads as a wireframe
  // silhouette covering both the outer outline and a few interior facet rings.
  const edges = new THREE.EdgesGeometry(lathe, 1);
  lathe.dispose();
  return edges;
}

/** Bake per-vertex color attribute on a unit-height canopy geometry.
 *
 *  Two effects combined, both scaled by `strength` ∈ [0,1]:
 *
 *  1. Vertical gradient — dark at y=0 (base), full bright at y=1 (top).
 *  2. Directional face shading — dot the vertex normal against a fixed
 *     3D pseudo-light. On a non-indexed icosahedron each face has its
 *     own outward normal, so this gives every facet a distinct
 *     brightness, defining the low-poly silhouette without runtime
 *     lighting.
 *
 *  `vertexColors: true` on the canopy material multiplies these per-
 *  vertex colors with the per-instance color (age lerp), so the same
 *  tree gets both an age-driven hue AND clear facet definition. */
function bakeVertexShading(geom: THREE.BufferGeometry, strength: number): void {
  // Sun direction from the fixed LIGHTING constants (shared with buildings
  // and the island mesh) so the scene agrees on where the sun is.
  const sun = sunDir(LIGHTING_SUN_AZIMUTH_DEG, LIGHTING_SUN_ELEVATION_DEG);
  const LIGHT_X = sun.x;
  const LIGHT_Y = sun.y;
  const LIGHT_Z = sun.z;
  // Shadow side dims to (1 - DIRECTIONAL_RANGE × strength); lit side
  // stays at 1. 0.75 gives a ~50% spread between dimmest and brightest
  // facet at strength=0.65 (default), matching the strong lit/shadow
  // contrast in low-poly tree art.
  const DIRECTIONAL_RANGE = 0.75;
  // Vertical gradient is the secondary effect — keep it subtle so
  // directional facet contrast dominates the silhouette.
  const VERTICAL_RANGE = 0.35;

  const pos = geom.getAttribute('position');
  const nrm = geom.getAttribute('normal');
  const count = pos.count;
  const colors = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    const y = pos.getY(i);
    const yClamped = y < 0 ? 0 : y > 1 ? 1 : y;
    const heightShade = 1 - strength * VERTICAL_RANGE * (1 - yClamped);

    let faceShade = 1;
    if (nrm) {
      const dot = nrm.getX(i) * LIGHT_X + nrm.getY(i) * LIGHT_Y + nrm.getZ(i) * LIGHT_Z;
      const faceFactor = (dot + 1) * 0.5; // [0,1]
      faceShade = 1 - strength * DIRECTIONAL_RANGE * (1 - faceFactor);
    }

    const c = heightShade * faceShade;
    colors[i * 3 + 0] = c;
    colors[i * 3 + 1] = c;
    colors[i * 3 + 2] = c;
  }
  geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

export function createTreeRenderer(
  placements: TreePlacement[],
  commits: CommitEntry[] | null,
  busyness: BusynessThresholds,
  stats: RepoStats | null | undefined,
  scannedAt?: string | null
): Trees {
  let cfg = TREES.value;

  // Per-tree height/width come from treeEncoding (treeHeight / treeRadius),
  // the single source shared with the firefly orbit field.
  const trunkHeightFrac = cfg.TRUNK_HEIGHT_FRAC;
  const trunkRadiusFrac = cfg.TRUNK_RADIUS_FRAC;
  // Fraction of trunk height hidden inside the canopy bottom. The
  // canopy is positioned this far below trunk-top so the trunk visibly
  // enters the canopy instead of just touching its bottom vertex.
  const canopyOverlapFrac = Math.max(0, Math.min(1, cfg.CANOPY_TRUNK_OVERLAP_FRAC));

  // Age + size ranges come from the backend-precomputed stats (commitDates +
  // sparsest/grandest commit), not a client-side scan of `commits`. scannedAt
  // (manifest.scanned_at) drives the absolute-age staleness lift on height.
  const ageRange: AgeRange = computeAgeRange(stats, scannedAt);
  const sizeRange: SizeRange = computeSizeRange(stats);

  /** Resolve the commit a placement points at, or null when the index is
   *  out of range / commits is absent. */
  function commitForPlacement(i: number): CommitEntry | null {
    if (commits && placements[i].commitIndex >= 0 && placements[i].commitIndex < commits.length) {
      return commits[placements[i].commitIndex];
    }
    return null;
  }

  // HEIGHT is driven by AGE; WIDTH by FILES (attenuated by age). Both
  // formulas live in treeEncoding so the firefly orbit field derives from
  // the identical math (see treeHeight / treeRadius).
  function perTreeHeight(i: number): number {
    return treeHeight(commitForPlacement(i), ageRange, cfg);
  }

  function perTreeRadius(i: number): number {
    return treeRadius(commitForPlacement(i), ageRange, sizeRange, cfg);
  }

  // COLOR follows COMMITS-PER-DAY: solo-commit days interpolate toward
  // COLOR_SOLO_DAY; busy days (many commits the same day)
  // interpolate toward COLOR_BUSY_DAY. All commits on the
  // same date share a color. Log-normalized so the typical 1–10
  // commits-per-day band stays readable when one outlier day spikes to
  // 50+ commits.
  //
  // Interpolation is done in OKLCH (shortest hue arc) so the midpoint
  // between distant hues stays saturated — picking purple + teal gives
  // a vivid blue through the middle instead of a muddy gray.
  function perTreeColor(i: number, target: THREE.Color): void {
    let t = 0.5;
    if (commits && placements[i].commitIndex >= 0 && placements[i].commitIndex < commits.length) {
      t = dailyCountTByIndex(commits, placements[i].commitIndex, busyness);
    }
    interpolateOklch(soloDayColor, busyDayColor, t, target);
  }

  const trunkGeometry = new THREE.CylinderGeometry(1.0, 1.0, 1.0, 12);
  trunkGeometry.translate(0, 0.5, 0);

  const trunkMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    toneMapped: false,
    ...NEUTRAL_POLYGON_OFFSET,
  });
  setColorFromHex(trunkMaterial.color, cfg.TRUNK_COLOR);

  const canopyMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    toneMapped: false,
    vertexColors: true,
    ...NEUTRAL_POLYGON_OFFSET,
  });

  const tmpMatrix = new THREE.Matrix4();
  const tmpV3 = new THREE.Vector3();
  const tmpScale = new THREE.Vector3();
  const tmpQ = new THREE.Quaternion();
  const tmpColor = new THREE.Color();
  const busyDayColor = new THREE.Color();
  const soloDayColor = new THREE.Color();
  // Shared collapse target for scrub-gated instances — a single degenerate
  // matrix reused across every hidden tree, so hiding costs no allocation.
  const ZERO_SCALE_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0);
  setColorFromHex(busyDayColor, cfg.COLOR_BUSY_DAY);
  setColorFromHex(soloDayColor, cfg.COLOR_SOLO_DAY);

  const totalTrees = placements.length;

  // Height + radius are needed by both the canopy and trunk instance loops;
  // compute each once here instead of twice (treeRadius also re-derives height
  // internally, so the canopy/trunk loops re-ran the encoding ~4× per tree).
  const heights = new Float64Array(totalTrees);
  const radii = new Float64Array(totalTrees);
  for (let i = 0; i < totalTrees; i++) {
    heights[i] = perTreeHeight(i);
    radii[i] = perTreeRadius(i);
  }

  // Base color cache: keyed by commit SHA, value is the hex color string
  // (e.g. "#5e8a3a") computed during bake. Populated below and rebuilt
  // on every refresh(). colorForSha reads from here, not the instance buffer.
  const _baseColorBySha = new Map<string, string>();

  // O(1) index from sha → canopy instance. Populated in the bake loop
  // alongside _baseColorBySha, cleared + rebuilt on refresh(). Lets
  // findTreeBySha and getInstanceTransform skip nested loops.
  const _treeIndexBySha = new Map<
    string,
    { mesh: THREE.InstancedMesh; instanceId: number; commit: CommitEntry }
  >();

  // Canopies + trunks are split into chunks of instances (see
  // utils/instanceChunkSize.ts). Instance slot k of a chunk renders placement
  // placementOrder[k]; commitForInstance reads that map generically, so the
  // picker never learns about chunking.
  //
  // Chunk membership is SPATIAL (coarse grid tiles), not placement order, so
  // each chunk covers a compact region and per-chunk frustum culling drops
  // off-screen forest. That culling is load-bearing on mobile: submitting
  // masses of far-out-of-frustum instances is what distinguished the two
  // flickering components (trees, fireflies — culling off) from the clean one
  // (buildings — culled per cell) on the Xclipse driver.
  const chunkSize = instanceChunkSize();
  const SPATIAL_TILE = 256;
  const spatialOrder = new Array<number>(totalTrees);
  for (let i = 0; i < totalTrees; i++) spatialOrder[i] = i;
  spatialOrder.sort((a, b) => {
    const az = Math.floor(placements[a].y / SPATIAL_TILE);
    const bz = Math.floor(placements[b].y / SPATIAL_TILE);
    if (az !== bz) return az - bz;
    const ax = Math.floor(placements[a].x / SPATIAL_TILE);
    const bx = Math.floor(placements[b].x / SPATIAL_TILE);
    if (ax !== bx) return ax - bx;
    return a - b;
  });
  const canopyGeometry = buildCanopyGeometry();
  bakeVertexShading(canopyGeometry, cfg.SHADING_STRENGTH);

  // Full-scale matrices cached per PLACEMENT index (not instance slot), so
  // setScrubCommit can restore a gated-out tree without recomputing its
  // transform. Only trees actually zero-scaled by scrubbing pay for a clone.
  const canopyFullMatrix = new Array<THREE.Matrix4>(totalTrees);
  const trunkFullMatrix = new Array<THREE.Matrix4>(totalTrees);

  const canopyMeshes: THREE.InstancedMesh[] = [];
  const trunkMeshes: THREE.InstancedMesh[] = [];

  for (let start = 0; start < totalTrees; start += chunkSize) {
    const len = Math.min(chunkSize, totalTrees - start);
    // Chunk slot k ↔ placement spatialOrder[start+k], shared by the canopy +
    // trunk pair.
    const placementOrder = new Array<number>(len);
    for (let k = 0; k < len; k++) placementOrder[k] = spatialOrder[start + k];

    const canopyMesh = new THREE.InstancedMesh(canopyGeometry, canopyMaterial, len);
    canopyMesh.name = 'tree-canopy';
    canopyMesh.renderOrder = RENDER_ORDERS.PARK_FOLIAGE;
    canopyMesh.visible = cfg.ENABLED;
    canopyMesh.userData.meshKind = 'tree-canopy';
    canopyMesh.userData.placementOrder = placementOrder;

    const trunkMesh = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, len);
    trunkMesh.name = 'tree-trunk';
    trunkMesh.renderOrder = RENDER_ORDERS.PARK_FOLIAGE;
    trunkMesh.visible = cfg.ENABLED;
    trunkMesh.userData.meshKind = 'tree-trunk';
    trunkMesh.userData.placementOrder = placementOrder;

    for (let k = 0; k < len; k++) {
      const i = placementOrder[k];
      const p = placements[i];
      const h = heights[i];
      const r = radii[i];
      const trunkH = h * trunkHeightFrac;

      // Canopy base sits BELOW the trunk top by `canopyOverlapFrac × trunkH`,
      // so the trunk visibly enters the canopy from below instead of touching
      // it at a single point. Y-scale = h, XZ-scale = r → a vertical ellipsoid
      // when h > r.
      const canopyBaseY = trunkH * (1 - canopyOverlapFrac);
      tmpV3.set(p.x, canopyBaseY, p.y);
      tmpScale.set(r, h, r);
      tmpMatrix.compose(tmpV3, tmpQ, tmpScale);
      canopyMesh.setMatrixAt(k, tmpMatrix);
      canopyFullMatrix[i] = tmpMatrix.clone();

      perTreeColor(i, tmpColor);
      // Cache the base color before writing it to the instance buffer; the
      // buffer can later be modified by tints, the cache stays stable.
      const c = commits?.[placements[i].commitIndex];
      if (c?.sha) {
        _baseColorBySha.set(c.sha, `#${tmpColor.getHexString()}`);
        _treeIndexBySha.set(c.sha, { mesh: canopyMesh, instanceId: k, commit: c });
      }
      canopyMesh.setColorAt(k, tmpColor);

      const trunkR = r * trunkRadiusFrac;
      tmpV3.set(p.x, 0, p.y);
      tmpScale.set(trunkR, trunkH, trunkR);
      tmpMatrix.compose(tmpV3, tmpQ, tmpScale);
      trunkMesh.setMatrixAt(k, tmpMatrix);
      trunkFullMatrix[i] = tmpMatrix.clone();
    }
    canopyMesh.instanceMatrix.needsUpdate = true;
    if (canopyMesh.instanceColor) canopyMesh.instanceColor.needsUpdate = true;
    trunkMesh.instanceMatrix.needsUpdate = true;

    // Per-chunk instanced bounding sphere → real frustum culling. Trees are
    // static, so the sphere computed from the instance matrices is exact
    // (scrub only ever zero-scales instances, shrinking the content).
    canopyMesh.computeBoundingSphere();
    trunkMesh.computeBoundingSphere();

    canopyMeshes.push(canopyMesh);
    trunkMeshes.push(trunkMesh);
  }

  const group = new THREE.Group();
  group.name = 'trees';
  group.userData.cyberpunkValley = 'trees';
  group.visible = cfg.ENABLED;
  for (const m of canopyMeshes) group.add(m);
  for (const m of trunkMeshes) group.add(m);

  function refresh(): void {
    cfg = TREES.value;
    group.visible = cfg.ENABLED;
    for (const m of canopyMeshes) m.visible = cfg.ENABLED;
    for (const m of trunkMeshes) m.visible = cfg.ENABLED;

    setColorFromHex(trunkMaterial.color, cfg.TRUNK_COLOR);
    setColorFromHex(busyDayColor, cfg.COLOR_BUSY_DAY);
    setColorFromHex(soloDayColor, cfg.COLOR_SOLO_DAY);

    // Rebuild the base-color cache and sha index before re-baking so
    // colorForSha / findTreeBySha always reflect the current config colors.
    _baseColorBySha.clear();
    _treeIndexBySha.clear();
    for (const canopyMesh of canopyMeshes) {
      const order = canopyMesh.userData.placementOrder as number[];
      for (let k = 0; k < order.length; k++) {
        const i = order[k];
        perTreeColor(i, tmpColor);
        const commit = commits?.[placements[i].commitIndex];
        if (commit?.sha) {
          _baseColorBySha.set(commit.sha, `#${tmpColor.getHexString()}`);
          _treeIndexBySha.set(commit.sha, { mesh: canopyMesh, instanceId: k, commit });
        }
        canopyMesh.setColorAt(k, tmpColor);
      }
      if (canopyMesh.instanceColor) canopyMesh.instanceColor.needsUpdate = true;
    }
  }

  function dispose(): void {
    if (group.parent) group.parent.remove(group);
    canopyGeometry.dispose();
    trunkGeometry.dispose();
    canopyMaterial.dispose();
    trunkMaterial.dispose();
  }

  function commitForInstance(mesh: THREE.InstancedMesh, instanceId: number): CommitEntry | null {
    const order = mesh.userData?.placementOrder as number[] | undefined;
    if (!order) return null;
    if (instanceId < 0 || instanceId >= order.length) return null;
    const placementIdx = order[instanceId];
    const p = placements[placementIdx];
    if (!p) return null;
    if (!commits) return null;
    if (p.commitIndex < 0 || p.commitIndex >= commits.length) return null;
    return commits[p.commitIndex];
  }

  function findTreeBySha(sha: string): {
    mesh: THREE.InstancedMesh;
    instanceId: number;
    commit: CommitEntry;
  } | null {
    return _treeIndexBySha.get(sha) ?? null;
  }

  function getInstanceTransform(sha: string, out: THREE.Matrix4): boolean {
    const idx = _treeIndexBySha.get(sha);
    if (!idx) return false;
    idx.mesh.getMatrixAt(idx.instanceId, out);
    return true;
  }

  function colorForSha(sha: string): string | null {
    return _baseColorBySha.get(sha) ?? null;
  }

  function getTreeBoundsBySha(sha: string): {
    x: number;
    y: number;
    z: number;
    height: number;
    radius: number;
  } | null {
    if (!commits) return null;
    const hit = _treeIndexBySha.get(sha);
    if (!hit) return null;
    // Find the source placement index: the meshRecord's placementOrder
    // array maps slot → placement index. Read it directly.
    const placementIdx = (hit.mesh.userData.placementOrder as number[])[hit.instanceId];
    if (placementIdx == null) return null;
    const p = placements[placementIdx];
    return {
      x: p.x,
      y: 0,
      z: p.y,
      height: perTreeHeight(placementIdx),
      radius: perTreeRadius(placementIdx),
    };
  }

  // Threshold applied by the last setScrubCommit call. Starts at null (every
  // tree full-scale, matching how the meshes were just baked), so the first
  // real scrub only rewrites the instances that actually need to hide.
  let _scrubCommit: number | null = null;

  function scrubVisible(commitIndex: number, threshold: number | null): boolean {
    return threshold === null || commitIndex <= threshold;
  }

  function applyScrubToMesh(
    mesh: THREE.InstancedMesh,
    fullMatrix: THREE.Matrix4[],
    threshold: number | null
  ): void {
    const order = mesh.userData.placementOrder as number[];
    let changed = false;
    for (let slot = 0; slot < order.length; slot++) {
      const placementIdx = order[slot];
      const commitIndex = placements[placementIdx].commitIndex;
      const wasVisible = scrubVisible(commitIndex, _scrubCommit);
      const nowVisible = scrubVisible(commitIndex, threshold);
      if (wasVisible === nowVisible) continue;
      mesh.setMatrixAt(slot, nowVisible ? fullMatrix[placementIdx] : ZERO_SCALE_MATRIX);
      changed = true;
    }
    if (changed) mesh.instanceMatrix.needsUpdate = true;
  }

  function setScrubCommit(maxCommitIndex: number | null): void {
    if (maxCommitIndex === _scrubCommit) return;
    for (const m of canopyMeshes) applyScrubToMesh(m, canopyFullMatrix, maxCommitIndex);
    for (const m of trunkMeshes) applyScrubToMesh(m, trunkFullMatrix, maxCommitIndex);
    _scrubCommit = maxCommitIndex;
  }

  return {
    group,
    refresh,
    dispose,
    commitForInstance,
    findTreeBySha,
    getInstanceTransform,
    colorForSha,
    getTreeBoundsBySha,
    setScrubCommit,
  };
}
