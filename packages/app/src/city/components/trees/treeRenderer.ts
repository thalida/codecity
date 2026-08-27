// city/components/trees/treeRenderer.ts — merged static tree meshes: one
// world-space triangle list per spatial chunk, colors baked per-vertex, NOT
// instanced (mobile drivers corrupt instanced tree draws — Xclipse 950). A
// tree owns a contiguous vertex range, so picking maps faceIndex → placement.

import * as THREE from 'three';
import { TREES } from '@/state/settings/fields/trees';
import { RENDER_ORDERS } from '@/city/types/renderOrders';
import type { TreePlacement } from './treePlacement';
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

import { TREES_PER_CHUNK } from '@/city/utils/instanceChunkSize';
import { BYTE_MAX, VEC3_COMPONENTS, VERTS_PER_TRIANGLE } from '@/city/utils/bufferLayout';
import { NEUTRAL_POLYGON_OFFSET } from '@/city/utils/neutralPolygonOffset';
import treeVertSrc from './tree.vert.glsl?raw';
import treeFragSrc from './tree.frag.glsl?raw';
import { sunDir } from '@/city/utils/shaders/sunDir';
import { LIGHTING_SUN_AZIMUTH_DEG, LIGHTING_SUN_ELEVATION_DEG } from '@/city/constants/lighting';
import { epochDay, epochDayAt } from '@/utils/dates';
import type { BusynessThresholds, CommitEntry, RepoStats } from '@codecity/city';

export interface Trees {
  group: THREE.Group;
  refresh(): void;
  dispose(): void;
  /** Raycast hit → tree. Null for foreign meshes, out-of-range faces,
   *  commit-less placements, and scrub-hidden trees. */
  commitForFace(
    mesh: THREE.Object3D,
    faceIndex: number | null | undefined
  ): { commit: CommitEntry; placementIndex: number } | null;
  /** SHA → merged mesh + placement index; how the picker re-resolves a
   *  selection across world rebuilds. Null for unknown shas. */
  findTreeBySha(sha: string): {
    mesh: THREE.Mesh;
    instanceId: number;
    commit: CommitEntry;
  } | null;
  /** The tree's baked base color for the given SHA as a CSS hex string
   *  (e.g. "#5e8a3a"), or null when the sha can't be found. */
  colorForSha(sha: string): string | null;
  /** Compose the canopy world transform for `sha` into `out`, so the
   *  outline renderer can snap to the tree. False when not found. */
  getInstanceTransform(sha: string, out: THREE.Matrix4): boolean;
  /** Tree world position + dimensions by SHA (y is always the base, 0);
   *  null for unknown shas or a null commit list. */
  getTreeBoundsBySha(sha: string): {
    x: number;
    y: number;
    z: number;
    height: number;
    radius: number;
  } | null;
  /** Timeline scrub gate: hides trees whose commitIndex exceeds the value
   *  (rendering via shader uniform, picking via isScrubHidden); null = all. */
  setScrubCommit(maxCommitIndex: number | null): void;
  /** The scrubbed date, so each tree is the size it was then. */
  setScrubNow(nowMs: number | null): void;
  /** True when the scrub currently hides the tree at `placementIndex`. */
  isScrubHidden(placementIndex: number): boolean;
}

/** Shared canopy facet count: bump for rounder crowns, drop for chunkier. */
const TREE_CANOPY_FACETS = 6;

/** Canopy silhouette (bottom→top, both axes [0,1]): near-spherical so the
 *  crown reads as a ball, not a popsicle column. Shared by geometry + edges. */
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

/** Unit-height, unit-radius canopy: profile max X = 1.0, so XZ scale r
 *  gives an exact world radius r (height ≈ 2r reads as a circle). */
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

/** Canopy silhouette wireframe for ./outline.ts — built on the INDEXED
 *  lathe so EdgesGeometry collapses coplanar edges to ring boundaries. */
export function buildCanopyEdges(): THREE.EdgesGeometry {
  const lathe = new THREE.LatheGeometry(CANOPY_PROFILE as THREE.Vector2[], TREE_CANOPY_FACETS);
  // The 1° threshold keeps ring boundaries + the wrap seam: an outline
  // plus a few interior facet rings.
  const edges = new THREE.EdgesGeometry(lathe, 1);
  lathe.dispose();
  return edges;
}

/** Bake shading factors (vertical gradient × directional facet shade, both
 *  scaled by strength) that the merge multiplies into each tree's color. */
function bakeVertexShading(geom: THREE.BufferGeometry, strength: number): void {
  // Sun direction from the fixed LIGHTING constants (shared with buildings
  // and the island mesh) so the scene agrees on where the sun is.
  const sun = sunDir(LIGHTING_SUN_AZIMUTH_DEG, LIGHTING_SUN_ELEVATION_DEG);
  const LIGHT_X = sun.x;
  const LIGHT_Y = sun.y;
  const LIGHT_Z = sun.z;
  // 0.75 gives ~50% dimmest-to-brightest facet spread at default strength,
  // matching low-poly tree art's strong lit/shadow contrast.
  const DIRECTIONAL_RANGE = 0.75;
  // Vertical gradient is the secondary effect — keep it subtle so
  // directional facet contrast dominates the silhouette.
  const VERTICAL_RANGE = 0.35;

  const pos = geom.getAttribute('position');
  const nrm = geom.getAttribute('normal');
  const count = pos.count;
  const colors = new Float32Array(count * VEC3_COMPONENTS);

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
    const o = i * VEC3_COMPONENTS;
    colors[o] = c;
    colors[o + 1] = c;
    colors[o + 2] = c;
  }
  geom.setAttribute('color', new THREE.BufferAttribute(colors, VEC3_COMPONENTS));
}

export function createTreeRenderer(
  placements: TreePlacement[],
  commits: CommitEntry[] | null,
  busyness: BusynessThresholds,
  stats: RepoStats | null | undefined,
  scannedAt?: string | null
): Trees {
  let cfg = TREES.value;

  // Heights/widths come from treeEncoding — shared with the firefly field.
  const trunkHeightFrac = cfg.TRUNK_HEIGHT_FRAC;
  const trunkRadiusFrac = cfg.TRUNK_RADIUS_FRAC;
  // Fraction of trunk height inside the canopy, so the trunk visibly
  // enters it instead of touching a single vertex.
  const canopyOverlapFrac = Math.max(0, Math.min(1, cfg.CANOPY_TRUNK_OVERLAP_FRAC));

  // Ranges come from backend-precomputed stats, not a client-side scan;
  // scannedAt drives the absolute-age staleness lift on height.
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

  // HEIGHT follows AGE, WIDTH follows FILES (age-attenuated); formulas live
  // in treeEncoding so firefly orbits derive from identical math.
  function perTreeHeight(i: number): number {
    return treeHeight(commitForPlacement(i), ageRange, cfg);
  }

  function perTreeRadius(i: number): number {
    return treeRadius(commitForPlacement(i), ageRange, sizeRange, cfg);
  }

  // The day the scrub sits on, or null in Live. The shader regrows what it
  // draws; CPU readers ask the same formulas, so a focus frames what's shown.
  let _scrubDay: number | null = null;

  function sizeAt(i: number): { height: number; radius: number } {
    if (_scrubDay === null) return { height: heights[i], radius: radii[i] };
    const commit = commitForPlacement(i);
    const scrubbed: AgeRange = { ...ageRange, scanned: _scrubDay };
    return {
      height: treeHeight(commit, scrubbed, cfg),
      radius: treeRadius(commit, scrubbed, sizeRange, cfg),
    };
  }

  // COLOR follows COMMITS-PER-DAY between the SOLO/BUSY endpoints (same-date
  // commits share a color), interpolated in OKLCH so midpoints stay vivid.
  function perTreeColor(i: number, target: THREE.Color): void {
    let t = 0.5;
    if (commits && placements[i].commitIndex >= 0 && placements[i].commitIndex < commits.length) {
      t = dailyCountTByIndex(commits, placements[i].commitIndex, busyness);
    }
    interpolateOklch(soloDayColor, busyDayColor, t, target);
  }

  const tmpColor = new THREE.Color();
  const busyDayColor = new THREE.Color();
  const soloDayColor = new THREE.Color();
  const _trunkColor = new THREE.Color();
  setColorFromHex(busyDayColor, cfg.COLOR_BUSY_DAY);
  setColorFromHex(soloDayColor, cfg.COLOR_SOLO_DAY);

  const totalTrees = placements.length;

  // Computed once: the bake AND the transform/bounds lookups both read these.
  const heights = new Float64Array(totalTrees);
  const radii = new Float64Array(totalTrees);
  for (let i = 0; i < totalTrees; i++) {
    heights[i] = perTreeHeight(i);
    radii[i] = perTreeRadius(i);
  }

  // sha → hex base color, filled during bake, rebuilt on refresh().
  const _baseColorBySha = new Map<string, string>();

  // O(1) sha → merged mesh + placement index, rebuilt on refresh().
  const _treeIndexBySha = new Map<
    string,
    { mesh: THREE.Mesh; instanceId: number; commit: CommitEntry }
  >();

  // Source geometries the bake reads from (never rendered, never uploaded).
  const canopyGeometry = buildCanopyGeometry();
  bakeVertexShading(canopyGeometry, cfg.SHADING_STRENGTH);
  const canopyPos = canopyGeometry.getAttribute('position') as THREE.BufferAttribute;
  const canopyShade = canopyGeometry.getAttribute('color') as THREE.BufferAttribute;
  // Open-ended: the caps were never visible (bottom flush with the ground,
  // top inside the canopy overlap) and the merged bake pays per vertex.
  const trunkSource = new THREE.CylinderGeometry(1.0, 1.0, 1.0, 12, 1, true);
  trunkSource.translate(0, 0.5, 0);
  const trunkFlat = trunkSource.toNonIndexed();
  trunkSource.dispose();
  const trunkPos = trunkFlat.getAttribute('position') as THREE.BufferAttribute;
  const CANOPY_VERTS = canopyPos.count;
  const TRUNK_VERTS = trunkPos.count;
  const PER_TREE_VERTS = CANOPY_VERTS + TRUNK_VERTS;

  const mergedMaterial = new THREE.ShaderMaterial({
    vertexShader: treeVertSrc,
    fragmentShader: treeFragSrc,
    uniforms: { uScrubCommit: { value: -1 } },
    vertexColors: true,
    ...NEUTRAL_POLYGON_OFFSET,
  });

  // SPATIAL chunk membership (coarse grid tiles): compact chunks make
  // per-chunk frustum culling actually drop off-screen forest.
  const chunkSize = TREES_PER_CHUNK;
  // Grid tile the sort buckets by, in world units: coarse enough that a tile
  // holds many trees, fine enough that a chunk stays compact for culling.
  const SPATIAL_TILE_WORLD_UNITS = 256;
  const spatialOrder = new Array<number>(totalTrees);
  for (let i = 0; i < totalTrees; i++) spatialOrder[i] = i;
  spatialOrder.sort((a, b) => {
    const az = Math.floor(placements[a].y / SPATIAL_TILE_WORLD_UNITS);
    const bz = Math.floor(placements[b].y / SPATIAL_TILE_WORLD_UNITS);
    if (az !== bz) return az - bz;
    const ax = Math.floor(placements[a].x / SPATIAL_TILE_WORLD_UNITS);
    const bx = Math.floor(placements[b].x / SPATIAL_TILE_WORLD_UNITS);
    if (ax !== bx) return ax - bx;
    return a - b;
  });

  /** One tree's vertex colors (shading × age color; flat trunk), shared by
   *  bake and refresh(); also feeds the sha caches. */
  function writeTreeColors(mesh: THREE.Mesh, colors: Uint8Array, slot: number, i: number): void {
    perTreeColor(i, tmpColor);
    const commit = commits?.[placements[i].commitIndex];
    if (commit?.sha) {
      _baseColorBySha.set(commit.sha, `#${tmpColor.getHexString()}`);
      _treeIndexBySha.set(commit.sha, { mesh, instanceId: i, commit });
    }
    const base = slot * PER_TREE_VERTS;
    for (let v = 0; v < CANOPY_VERTS; v++) {
      const o = (base + v) * VEC3_COMPONENTS;
      colors[o] = Math.round(canopyShade.getX(v) * tmpColor.r * BYTE_MAX);
      colors[o + 1] = Math.round(canopyShade.getY(v) * tmpColor.g * BYTE_MAX);
      colors[o + 2] = Math.round(canopyShade.getZ(v) * tmpColor.b * BYTE_MAX);
    }
    const tr = Math.round(_trunkColor.r * BYTE_MAX);
    const tg = Math.round(_trunkColor.g * BYTE_MAX);
    const tb = Math.round(_trunkColor.b * BYTE_MAX);
    for (let v = 0; v < TRUNK_VERTS; v++) {
      const o = (base + CANOPY_VERTS + v) * VEC3_COMPONENTS;
      colors[o] = tr;
      colors[o + 1] = tg;
      colors[o + 2] = tb;
    }
  }

  /** Bake one chunk's trees into a single world-space triangle list. */
  function buildMergedChunk(placementOrder: number[]): THREE.Mesh {
    const positions = new Float32Array(placementOrder.length * PER_TREE_VERTS * VEC3_COMPONENTS);
    // Byte colors (normalized in the shader): identical rendered color at a
    // third of the float footprint.
    const colors = new Uint8Array(placementOrder.length * PER_TREE_VERTS * VEC3_COMPONENTS);
    const commitIdx = new Float32Array(placementOrder.length * PER_TREE_VERTS);
    const geo = new THREE.BufferGeometry();
    const mesh = new THREE.Mesh(geo, mergedMaterial);
    // Chunk vertices are baked in world space, so the mesh transform stays
    // identity for its whole life.
    mesh.matrixAutoUpdate = false;
    for (let slot = 0; slot < placementOrder.length; slot++) {
      const i = placementOrder[slot];
      const p = placements[i];
      const h = heights[i];
      const r = radii[i];
      const trunkH = h * trunkHeightFrac;
      const trunkR = r * trunkRadiusFrac;
      // Canopy base sits canopyOverlapFrac×trunkH below the trunk top, so
      // the trunk visibly enters it from below.
      const canopyBaseY = trunkH * (1 - canopyOverlapFrac);
      const base = slot * PER_TREE_VERTS;
      for (let v = 0; v < CANOPY_VERTS; v++) {
        const o = (base + v) * VEC3_COMPONENTS;
        positions[o] = p.x + canopyPos.getX(v) * r;
        positions[o + 1] = canopyBaseY + canopyPos.getY(v) * h;
        positions[o + 2] = p.y + canopyPos.getZ(v) * r;
      }
      for (let v = 0; v < TRUNK_VERTS; v++) {
        const o = (base + CANOPY_VERTS + v) * VEC3_COMPONENTS;
        positions[o] = p.x + trunkPos.getX(v) * trunkR;
        positions[o + 1] = trunkPos.getY(v) * trunkH;
        positions[o + 2] = p.y + trunkPos.getZ(v) * trunkR;
      }
      writeTreeColors(mesh, colors, slot, i);
      commitIdx.fill(placements[i].commitIndex, base, base + PER_TREE_VERTS);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, VEC3_COMPONENTS));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, VEC3_COMPONENTS, true));
    geo.setAttribute('aCommitIndex', new THREE.BufferAttribute(commitIdx, 1));
    mesh.name = 'trees-chunk';
    mesh.renderOrder = RENDER_ORDERS.PARK_FOLIAGE;
    mesh.visible = cfg.ENABLED;
    mesh.userData.meshKind = 'trees';
    mesh.userData.placementOrder = placementOrder;
    // Layout facts so tests can slice a tree's range without hand-syncs.
    mesh.userData.canopyVerts = CANOPY_VERTS;
    mesh.userData.trunkVerts = TRUNK_VERTS;
    return mesh;
  }

  setColorFromHex(_trunkColor, cfg.TRUNK_COLOR);
  const mergedMeshes: THREE.Mesh[] = [];
  for (let start = 0; start < totalTrees; start += chunkSize) {
    const len = Math.min(chunkSize, totalTrees - start);
    // Chunk slot k ↔ placement spatialOrder[start+k].
    const placementOrder = new Array<number>(len);
    for (let k = 0; k < len; k++) placementOrder[k] = spatialOrder[start + k];
    mergedMeshes.push(buildMergedChunk(placementOrder));
  }

  // One texel per tree for the vertex shader to regrow it from. Whole epoch
  // days like treeEncoding's dateToDays, so Live comes out a ratio of 1.
  const growthWidth = Math.min(1024, Math.max(1, totalTrees));
  const growthHeight = Math.ceil(totalTrees / growthWidth);
  const growthData = new Float32Array(growthWidth * growthHeight * 4);
  for (let i = 0; i < totalTrees; i++) {
    const commit = commits?.[placements[i].commitIndex];
    const o = i * 4;
    // -1 marks a placement with no commit: it took the midpoint height, so
    // there is no age to scrub through. An unreadable date falls to day 0.
    const day = commit ? epochDay(commit.date) : NaN;
    growthData[o] = !commit ? -1 : Number.isNaN(day) ? 0 : day;
    growthData[o + 1] = placements[i].x;
    growthData[o + 2] = placements[i].y;
    growthData[o + 3] = heights[i];
  }
  const growthTex = new THREE.DataTexture(
    growthData,
    growthWidth,
    growthHeight,
    THREE.RGBAFormat,
    THREE.FloatType
  );
  growthTex.needsUpdate = true;

  mergedMaterial.uniforms.uGrowth = { value: growthTex };
  mergedMaterial.uniforms.uGrowthSize = { value: new THREE.Vector2(growthWidth, growthHeight) };
  mergedMaterial.uniforms.uHalfLifeDays = { value: Math.max(1, cfg.HALF_LIFE_DAYS) };
  mergedMaterial.uniforms.uMinHeight = { value: cfg.MIN_HEIGHT };
  mergedMaterial.uniforms.uMaxHeight = { value: cfg.MAX_HEIGHT };
  mergedMaterial.uniforms.uWidthAgeFloor = { value: Math.max(0, Math.min(1, cfg.WIDTH_AGE_FLOOR)) };
  // The day the heights were baked against: Live leaves the geometry untouched,
  // Timeline moves it to the scrubbed day.
  mergedMaterial.uniforms.uNowDay = { value: ageRange.scanned };

  const group = new THREE.Group();
  group.name = 'trees';
  group.userData.cyberpunkValley = 'trees';
  group.visible = cfg.ENABLED;
  for (const m of mergedMeshes) group.add(m);

  function refresh(): void {
    cfg = TREES.value;
    group.visible = cfg.ENABLED;
    for (const m of mergedMeshes) m.visible = cfg.ENABLED;

    setColorFromHex(_trunkColor, cfg.TRUNK_COLOR);
    setColorFromHex(busyDayColor, cfg.COLOR_BUSY_DAY);
    setColorFromHex(soloDayColor, cfg.COLOR_SOLO_DAY);

    // Rebuilt before re-baking so the sha caches reflect current colors.
    _baseColorBySha.clear();
    _treeIndexBySha.clear();
    for (const mesh of mergedMeshes) {
      const order = mesh.userData.placementOrder as number[];
      const colorAttr = mesh.geometry.getAttribute('color') as THREE.BufferAttribute;
      const colors = colorAttr.array as Uint8Array;
      for (let slot = 0; slot < order.length; slot++) {
        writeTreeColors(mesh, colors, slot, order[slot]);
      }
      colorAttr.needsUpdate = true;
    }
  }

  function dispose(): void {
    if (group.parent) group.parent.remove(group);
    canopyGeometry.dispose();
    trunkFlat.dispose();
    for (const m of mergedMeshes) m.geometry.dispose();
    mergedMaterial.dispose();
  }

  // Last scrub threshold: rendering reads the uniform, picking reads this.
  let _scrubCommit: number | null = null;

  function isScrubHidden(placementIndex: number): boolean {
    const p = placements[placementIndex];
    if (!p) return false;
    return _scrubCommit !== null && p.commitIndex > _scrubCommit;
  }

  function commitForFace(
    mesh: THREE.Object3D,
    faceIndex: number | null | undefined
  ): { commit: CommitEntry; placementIndex: number } | null {
    if (faceIndex == null || !commits) return null;
    const order = mesh.userData?.placementOrder as number[] | undefined;
    if (!order || mesh.userData?.meshKind !== 'trees') return null;
    // Non-indexed list: face f spans vertices [3f, 3f+3); every tree owns
    // PER_TREE_VERTS consecutive vertices.
    const slot = Math.floor((faceIndex * VERTS_PER_TRIANGLE) / PER_TREE_VERTS);
    if (slot < 0 || slot >= order.length) return null;
    const placementIndex = order[slot];
    if (isScrubHidden(placementIndex)) return null;
    const p = placements[placementIndex];
    if (p.commitIndex < 0 || p.commitIndex >= commits.length) return null;
    return { commit: commits[p.commitIndex], placementIndex };
  }

  function findTreeBySha(sha: string): {
    mesh: THREE.Mesh;
    instanceId: number;
    commit: CommitEntry;
  } | null {
    return _treeIndexBySha.get(sha) ?? null;
  }

  const _tmpPos = new THREE.Vector3();
  const _tmpScale = new THREE.Vector3();
  const _tmpQuat = new THREE.Quaternion();

  function getInstanceTransform(sha: string, out: THREE.Matrix4): boolean {
    const idx = _treeIndexBySha.get(sha);
    if (!idx) return false;
    const i = idx.instanceId;
    const p = placements[i];
    const { height: h, radius: r } = sizeAt(i);
    const canopyBaseY = h * trunkHeightFrac * (1 - canopyOverlapFrac);
    _tmpPos.set(p.x, canopyBaseY, p.y);
    _tmpScale.set(r, h, r);
    out.compose(_tmpPos, _tmpQuat, _tmpScale);
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
    const p = placements[hit.instanceId];
    const size = sizeAt(hit.instanceId);
    return {
      x: p.x,
      y: 0,
      z: p.y,
      height: size.height,
      radius: size.radius,
    };
  }

  /** The day the scrub sits on, so every tree is the size it was then. Null
   *  (Live) restores the scan date, where the ratio is 1. */
  function setScrubNow(nowMs: number | null): void {
    const day = nowMs === null ? ageRange.scanned : epochDayAt(nowMs);
    if (day === mergedMaterial.uniforms.uNowDay.value) return;
    _scrubDay = nowMs === null ? null : day;
    mergedMaterial.uniforms.uNowDay.value = day;
  }

  function setScrubCommit(maxCommitIndex: number | null): void {
    if (maxCommitIndex === _scrubCommit) return;
    _scrubCommit = maxCommitIndex;
    mergedMaterial.uniforms.uScrubCommit.value = maxCommitIndex ?? -1;
  }

  return {
    group,
    refresh,
    dispose,
    commitForFace,
    findTreeBySha,
    getInstanceTransform,
    colorForSha,
    getTreeBoundsBySha,
    setScrubCommit,
    setScrubNow,
    isScrubHidden,
  };
}
