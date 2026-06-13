// city/components/trees/treeRenderer.ts — turns a TreePlacement[] + the manifest's
// commit list into one InstancedMesh per canopy detail level plus a
// shared trunk InstancedMesh.
//
//   tree-canopy-d{0,1,2} — low-poly icosahedron canopies, stretched to
//                          the per-tree (radius, height) by the instance
//                          matrix. Detail level (subdivision count) is
//                          picked per tree from commit FILES so bigger
//                          commits get more facets.
//   tree-trunk           — round cylinder, one instance per tree. Y scale
//                          = TRUNK_HEIGHT_FRAC × canopy height; XZ scale
//                          = TRUNK_RADIUS_FRAC × canopy radius.
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
import type { CommitEntry, BusynessThresholds } from '@/types';
import {
  computeAgeRange,
  computeSizeRange,
  ageT,
  sizeT,
  dailyCountTByIndex,
  treeHeight,
  treeRadius,
  type AgeRange,
  type SizeRange,
} from './treeEncoding';
import { interpolateOklch } from '@/city/utils/color/colors';
import { setColorFromHex } from '@/city/utils/color/setColorFromHex';
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
}

/** Three subdivision tiers for the LatheGeometry canopy. File count
 *  drives which tier each tree lands in. Segment counts live in TREES
 *  config (FACETS_LOW / MID / HIGH) so they're user-tunable. */
const DETAIL_LEVELS = [0, 1, 2] as const;
type DetailLevel = (typeof DETAIL_LEVELS)[number];

/** Lathe control points for the canopy silhouette: hand-picked (radius, height)
 *  pairs producing a low-poly Christmas-tree shape. Bottom→top. Both axes
 *  normalized to [0,1] so a single profile drives any detail tier. Shared by
 *  `buildCanopyGeometry` (the rendered canopy) and `buildCanopyEdges` (the
 *  outline wireframe) — keep these two in sync. */
const CANOPY_PROFILE: readonly THREE.Vector2[] = [
  new THREE.Vector2(0, 0),
  new THREE.Vector2(0.85, 0),
  new THREE.Vector2(1.0, 0.1),
  new THREE.Vector2(0.95, 0.25),
  new THREE.Vector2(0.82, 0.42),
  new THREE.Vector2(0.66, 0.58),
  new THREE.Vector2(0.5, 0.72),
  new THREE.Vector2(0.36, 0.82),
  new THREE.Vector2(0.24, 0.89),
  new THREE.Vector2(0.14, 0.94),
  new THREE.Vector2(0.06, 0.98),
  new THREE.Vector2(0, 1.0),
];

/** Build a unit-height (Y ∈ [0,1]), unit-radius teardrop canopy
 *  geometry at the given subdivision detail.
 *
 *  Profile (lathed around the Y axis) keeps the canopy BLUNT at the
 *  bottom — `(0.7, 0)` ring of width — instead of pinching to a point
 *  like an icosahedron does. The trunk visibly enters this wide
 *  bottom, matching low-poly tree art (rounded body, optional tapered
 *  top to an apex).
 *
 *  Profile max X = 1.0, so when the renderer applies XZ scale = r,
 *  the canopy world radius at its widest = r exactly. */
function buildCanopyGeometry(detail: DetailLevel): THREE.BufferGeometry {
  // Tree silhouette: widest band sits in the base region, tapering
  // upward with a soft curve to a rounded-looking apex. Reads as a
  // tree (christmas-tree / round-crown hybrid).
  //
  // Two features worth noting:
  //   - Rounded base: the bottom rim curves over two profile points
  //     (0.85 at y=0 → 1.00 at y=0.10) instead of a 90° corner, so
  //     the canopy looks chamfered rather than chopped.
  //   - Rounded apex: the upper portion uses extra profile points so
  //     the taper toward the top is spread across many small triangles.
  //     A lathe profile must converge to a point on the axis, but
  //     dense vertical samples near the apex make the silhouette read
  //     as a smooth dome rather than a sharp spike.
  const profile = CANOPY_PROFILE as THREE.Vector2[];
  const cfg = TREES.value;
  const segments = detail === 0 ? cfg.FACETS_LOW : detail === 1 ? cfg.FACETS_MID : cfg.FACETS_HIGH;
  const geom = new THREE.LatheGeometry(profile, segments);
  // Non-indexed + flat normals so the baked per-vertex shading reads
  // as discrete facets (each face shaded uniformly).
  const flat = geom.toNonIndexed();
  geom.dispose();
  flat.computeVertexNormals();
  return flat;
}

/** Build a clean wireframe `EdgesGeometry` for the canopy silhouette at
 *  the given detail level. Uses the SAME profile + segment count as
 *  `buildCanopyGeometry`, but on the indexed lathe (no `toNonIndexed`)
 *  so adjacent triangles share vertex normals — that lets `EdgesGeometry`
 *  collapse coplanar interior edges and emit only the ring boundaries.
 *
 *  Consumed by `./outline.ts` (the tree outline renderer). */
export function buildCanopyEdges(detail: DetailLevel): THREE.EdgesGeometry {
  const cfg = TREES.value;
  const segments = detail === 0 ? cfg.FACETS_LOW : detail === 1 ? cfg.FACETS_MID : cfg.FACETS_HIGH;
  const lathe = new THREE.LatheGeometry(CANOPY_PROFILE as THREE.Vector2[], segments);
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

interface CanopyMeshRecord {
  detail: DetailLevel;
  mesh: THREE.InstancedMesh;
  /** Indexes into `placements` for the trees rendered by this mesh,
   *  in the same order their instances were written. */
  placementOrder: number[];
}

export function createTreeRenderer(
  placements: TreePlacement[],
  commits: CommitEntry[] | null,
  busyness: BusynessThresholds
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

  const ageRange: AgeRange = computeAgeRange(commits);
  const sizeRange: SizeRange = computeSizeRange(commits);

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

  // FACETS are driven by FILES too: bigger commits get more subdivisions.
  // sizeT ∈ [0, 1] → detail ∈ {0, 1, 2}. Degenerate sizeT=0.5 maps to detail 1.
  function perTreeDetail(i: number): DetailLevel {
    let t = 0.5;
    if (commits && placements[i].commitIndex >= 0 && placements[i].commitIndex < commits.length) {
      t = sizeT(commits[placements[i].commitIndex], sizeRange);
    }
    const idx = Math.min(DETAIL_LEVELS.length - 1, Math.floor(t * DETAIL_LEVELS.length));
    return DETAIL_LEVELS[idx];
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

    if (
      cfg.AGE_DESAT_ENABLED &&
      commits &&
      placements[i].commitIndex >= 0 &&
      placements[i].commitIndex < commits.length
    ) {
      const aT = ageT(commits[placements[i].commitIndex], ageRange);
      const minFactor = cfg.AGE_SATURATION[0] / 100;
      const maxFactor = cfg.AGE_SATURATION[1] / 100;
      const factor = minFactor + aT * (maxFactor - minFactor);
      // Skip the HSL roundtrip when factor is effectively 1 — the newest
      // commit at MAX=100 lands here, saving one getHSL+setHSL per tree.
      if (factor < 0.999) {
        // Apply saturation scaling in HSL space.
        const hsl = _tmpHsl;
        target.getHSL(hsl);
        hsl.s *= factor;
        if (hsl.s < 0) hsl.s = 0;
        if (hsl.s > 1) hsl.s = 1;
        target.setHSL(hsl.h, hsl.s, hsl.l);
      }
    }
  }

  const trunkGeometry = new THREE.CylinderGeometry(1.0, 1.0, 1.0, 12);
  trunkGeometry.translate(0, 0.5, 0);

  const trunkMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    toneMapped: false,
  });
  setColorFromHex(trunkMaterial.color, cfg.TRUNK_COLOR);

  const canopyMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    toneMapped: false,
    vertexColors: true,
  });

  const tmpMatrix = new THREE.Matrix4();
  const tmpV3 = new THREE.Vector3();
  const tmpScale = new THREE.Vector3();
  const tmpQ = new THREE.Quaternion();
  const tmpColor = new THREE.Color();
  const busyDayColor = new THREE.Color();
  const soloDayColor = new THREE.Color();
  const _tmpHsl = { h: 0, s: 0, l: 0 };
  setColorFromHex(busyDayColor, cfg.COLOR_BUSY_DAY);
  setColorFromHex(soloDayColor, cfg.COLOR_SOLO_DAY);

  const totalTrees = placements.length;

  // Bucket placements by detail level. Each non-empty bucket gets its
  // own InstancedMesh + geometry; empty buckets contribute nothing.
  const buckets: number[][] = DETAIL_LEVELS.map(() => []);
  for (let i = 0; i < totalTrees; i++) {
    const detail = perTreeDetail(i);
    buckets[detail].push(i);
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

  const canopyRecords: CanopyMeshRecord[] = [];
  for (const detail of DETAIL_LEVELS) {
    const indices = buckets[detail];
    if (indices.length === 0) continue;
    const geom = buildCanopyGeometry(detail);
    bakeVertexShading(geom, cfg.SHADING_STRENGTH);

    const mesh = new THREE.InstancedMesh(geom, canopyMaterial, indices.length);
    mesh.name = `tree-canopy-d${detail}`;
    mesh.renderOrder = RENDER_ORDERS.PARK_FOLIAGE;
    mesh.frustumCulled = false;
    mesh.visible = cfg.ENABLED;
    mesh.userData.meshKind = 'tree-canopy';
    mesh.userData.placementOrder = indices;

    for (let k = 0; k < indices.length; k++) {
      const placementIdx = indices[k];
      const p = placements[placementIdx];
      const h = perTreeHeight(placementIdx);
      const r = perTreeRadius(placementIdx);
      const trunkH = h * trunkHeightFrac;

      // Canopy: base of the icosahedron sits BELOW the top of the
      // trunk by `canopyOverlapFrac × trunkH`, so the trunk visibly
      // enters the canopy from below instead of touching it at a
      // single point. Y-scale = h, XZ-scale = r → oval stretched
      // along Y when h > r.
      const canopyBaseY = trunkH * (1 - canopyOverlapFrac);
      tmpV3.set(p.x, canopyBaseY, p.y);
      tmpScale.set(r, h, r);
      tmpMatrix.compose(tmpV3, tmpQ, tmpScale);
      mesh.setMatrixAt(k, tmpMatrix);

      perTreeColor(placementIdx, tmpColor);
      // Cache the base color before writing it to the instance buffer.
      // The buffer can later be modified by tints; the cache stays stable.
      const c = commits?.[placements[placementIdx].commitIndex];
      if (c?.sha) {
        _baseColorBySha.set(c.sha, `#${tmpColor.getHexString()}`);
        _treeIndexBySha.set(c.sha, { mesh, instanceId: k, commit: c });
      }
      mesh.setColorAt(k, tmpColor);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    canopyRecords.push({ detail, mesh, placementOrder: indices });
  }

  // Trunk: one shared mesh, one instance per tree in placement order.
  // Identity array: trunk instance i is always placement i, but we
  // materialize it so commitForInstance stays uniform across canopy +
  // trunk lookups without a special-case branch.
  const trunkPlacementOrder = new Array<number>(totalTrees);
  for (let i = 0; i < totalTrees; i++) trunkPlacementOrder[i] = i;
  const trunkMesh = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, totalTrees);
  trunkMesh.name = 'tree-trunk';
  trunkMesh.renderOrder = RENDER_ORDERS.PARK_FOLIAGE;
  trunkMesh.frustumCulled = false;
  trunkMesh.visible = cfg.ENABLED;
  trunkMesh.userData.meshKind = 'tree-trunk';
  trunkMesh.userData.placementOrder = trunkPlacementOrder;

  for (let i = 0; i < totalTrees; i++) {
    const p = placements[i];
    const h = perTreeHeight(i);
    const r = perTreeRadius(i);
    const trunkH = h * trunkHeightFrac;
    const trunkR = r * trunkRadiusFrac;
    tmpV3.set(p.x, 0, p.y);
    tmpScale.set(trunkR, trunkH, trunkR);
    tmpMatrix.compose(tmpV3, tmpQ, tmpScale);
    trunkMesh.setMatrixAt(i, tmpMatrix);
  }
  trunkMesh.instanceMatrix.needsUpdate = true;

  const group = new THREE.Group();
  group.name = 'trees';
  group.userData.cyberpunkValley = 'trees';
  group.visible = cfg.ENABLED;
  for (const rec of canopyRecords) group.add(rec.mesh);
  group.add(trunkMesh);

  function refresh(): void {
    cfg = TREES.value;
    group.visible = cfg.ENABLED;
    for (const rec of canopyRecords) rec.mesh.visible = cfg.ENABLED;
    trunkMesh.visible = cfg.ENABLED;

    setColorFromHex(trunkMaterial.color, cfg.TRUNK_COLOR);
    setColorFromHex(busyDayColor, cfg.COLOR_BUSY_DAY);
    setColorFromHex(soloDayColor, cfg.COLOR_SOLO_DAY);

    // Rebuild the base-color cache and sha index before re-baking so
    // colorForSha / findTreeBySha always reflect the current config colors.
    _baseColorBySha.clear();
    _treeIndexBySha.clear();
    for (const rec of canopyRecords) {
      for (let k = 0; k < rec.placementOrder.length; k++) {
        const placementIdx = rec.placementOrder[k];
        perTreeColor(placementIdx, tmpColor);
        const commit = commits?.[placements[placementIdx].commitIndex];
        if (commit?.sha) {
          _baseColorBySha.set(commit.sha, `#${tmpColor.getHexString()}`);
          _treeIndexBySha.set(commit.sha, { mesh: rec.mesh, instanceId: k, commit });
        }
        rec.mesh.setColorAt(k, tmpColor);
      }
      if (rec.mesh.instanceColor) rec.mesh.instanceColor.needsUpdate = true;
    }
  }

  function dispose(): void {
    if (group.parent) group.parent.remove(group);
    for (const rec of canopyRecords) rec.mesh.geometry.dispose();
    trunkMesh.geometry.dispose();
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

  return {
    group,
    refresh,
    dispose,
    commitForInstance,
    findTreeBySha,
    getInstanceTransform,
    colorForSha,
    getTreeBoundsBySha,
  };
}
