// scene/trees/treeRenderer.ts — turns a TreePlacement[] + the manifest's
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
//                          = TRUNK_RADIUS_FRAC_OF_CANOPY × canopy radius.
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
// strength) goes through the rebuild path in hotReload.ts.

import * as THREE from 'three';
import { TREES } from '@/config/trees.js';
import { RENDER_ORDERS } from '@/constants';
import type { TreePlacement } from './treePlacement.js';
import type { CommitEntry } from '@/types';
import {
  computeAgeRange,
  computeSizeRange,
  computeCommitGaps,
  ageT,
  sizeT,
  gapTByIndex,
  type AgeRange,
  type SizeRange,
  type CommitGaps,
} from './treeEncoding.js';
import { interpolateOklch } from './colorInterp.js';

export interface Trees {
  group: THREE.Group;
  refresh(): void;
  dispose(): void;
}

/** Subdivision levels of the icosahedron canopy.
 *  detail 0 → 20 faces (very faceted),
 *  detail 1 → 80 faces,
 *  detail 2 → 320 faces (smoothest, still reads as low-poly). */
const DETAIL_LEVELS = [0, 1, 2] as const;
type DetailLevel = typeof DETAIL_LEVELS[number];

function setColorFromHex(target: THREE.Color, hex: string): void {
  target.setStyle(hex, THREE.LinearSRGBColorSpace);
}

/** Radial segment count per detail level. More segments = smoother
 *  silhouette + more facets. */
const DETAIL_SEGMENTS: Record<DetailLevel, number> = {
  0: 5,
  1: 8,
  2: 12,
};

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
  const profile: THREE.Vector2[] = [
    new THREE.Vector2(0, 0),         // axis — caps the base
    new THREE.Vector2(0.85, 0),      // bottom rim (slightly inset)
    new THREE.Vector2(1.00, 0.10),   // widest, just above the base
    new THREE.Vector2(0.95, 0.25),
    new THREE.Vector2(0.82, 0.42),
    new THREE.Vector2(0.66, 0.58),
    new THREE.Vector2(0.50, 0.72),
    new THREE.Vector2(0.36, 0.82),
    new THREE.Vector2(0.24, 0.89),   // upper shoulder
    new THREE.Vector2(0.14, 0.94),   // dense samples
    new THREE.Vector2(0.06, 0.98),   // near-apex
    new THREE.Vector2(0, 1.0),       // apex
  ];
  const segments = DETAIL_SEGMENTS[detail];
  const geom = new THREE.LatheGeometry(profile, segments);
  // Non-indexed + flat normals so the baked per-vertex shading reads
  // as discrete facets (each face shaded uniformly).
  const flat = geom.toNonIndexed();
  geom.dispose();
  flat.computeVertexNormals();
  return flat;
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
function bakeVertexShading(
  geom: THREE.BufferGeometry,
  strength: number,
): void {
  // 3D pseudo-light direction. Roughly normalized; tilted up + off-axis
  // so top facets read brighter than bottom and adjacent side facets
  // land at distinct brightnesses.
  const LIGHT_X = 0.55;
  const LIGHT_Y = 0.30;
  const LIGHT_Z = 0.78;
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
      const dot =
        nrm.getX(i) * LIGHT_X +
        nrm.getY(i) * LIGHT_Y +
        nrm.getZ(i) * LIGHT_Z;
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
): Trees {
  const cfg = TREES.get();

  // Height and width in absolute world units, independent of buildings.
  // Config exposes DIAMETER for width; convert to radius for the canopy.
  const minHeight = cfg.TREE_MIN_HEIGHT;
  const maxHeight = cfg.TREE_MAX_HEIGHT;
  const minRadius = cfg.TREE_MIN_WIDTH / 2;
  const maxRadius = cfg.TREE_MAX_WIDTH / 2;
  const trunkHeightFrac = cfg.TRUNK_HEIGHT_FRAC;
  const trunkRadiusFrac = cfg.TRUNK_RADIUS_FRAC_OF_CANOPY;
  // Fraction of trunk height hidden inside the canopy bottom. The
  // canopy is positioned this far below trunk-top so the trunk visibly
  // enters the canopy instead of just touching its bottom vertex.
  const canopyOverlapFrac = Math.max(0, Math.min(1, cfg.CANOPY_TRUNK_OVERLAP_FRAC));

  const ageRange: AgeRange = computeAgeRange(commits);
  const sizeRange: SizeRange = computeSizeRange(commits);
  const commitGaps: CommitGaps = computeCommitGaps(commits);

  // HEIGHT is driven by AGE: older commits grow taller. ageT=0 (oldest)
  // → max height; ageT=1 (newest) → min height. Degenerate cases
  // (null commits, missing commit, zero-span) collapse to midpoint.
  function perTreeHeight(i: number): number {
    if (commits && placements[i].commitIndex >= 0 && placements[i].commitIndex < commits.length) {
      const t = ageT(commits[placements[i].commitIndex], ageRange);
      return maxHeight - t * (maxHeight - minHeight);
    }
    return (minHeight + maxHeight) * 0.5;
  }

  // WIDTH (canopy XZ radius) is driven by FILES: more files = wider.
  function perTreeRadius(i: number): number {
    if (commits && placements[i].commitIndex >= 0 && placements[i].commitIndex < commits.length) {
      const t = sizeT(commits[placements[i].commitIndex], sizeRange);
      return minRadius + t * (maxRadius - minRadius);
    }
    return (minRadius + maxRadius) * 0.5;
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

  // COLOR follows COMMIT-GAP (days since previous commit): long gaps
  // (the "I came back to this project" comeback commits) interpolate
  // toward TREE_COLOR_NEW; short gaps (routine cadence) interpolate
  // toward TREE_COLOR_OLD. Log-normalized so typical 1–30 day
  // cadences stay readable when one outlier hits 365 days.
  //
  // Interpolation is done in OKLCH (shortest hue arc) so the midpoint
  // between distant hues stays saturated — picking purple + teal gives
  // a vivid blue through the middle instead of a muddy gray.
  function perTreeColor(i: number, target: THREE.Color): void {
    let t = 0.5;
    if (commits && placements[i].commitIndex >= 0 && placements[i].commitIndex < commits.length) {
      t = gapTByIndex(commitGaps, placements[i].commitIndex);
    }
    interpolateOklch(oldColor, newColor, t, target);
  }

  const trunkGeometry = new THREE.CylinderGeometry(1.0, 1.0, 1.0, 12);
  trunkGeometry.translate(0, 0.5, 0);

  const trunkMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    toneMapped: false,
  });
  setColorFromHex(trunkMaterial.color, cfg.TREE_TRUNK_COLOR);

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
  const oldColor = new THREE.Color();
  const newColor = new THREE.Color();
  setColorFromHex(oldColor, cfg.TREE_COLOR_OLD);
  setColorFromHex(newColor, cfg.TREE_COLOR_NEW);

  const totalTrees = placements.length;

  // Bucket placements by detail level. Each non-empty bucket gets its
  // own InstancedMesh + geometry; empty buckets contribute nothing.
  const buckets: number[][] = DETAIL_LEVELS.map(() => []);
  for (let i = 0; i < totalTrees; i++) {
    const detail = perTreeDetail(i);
    buckets[detail].push(i);
  }

  const canopyRecords: CanopyMeshRecord[] = [];
  for (const detail of DETAIL_LEVELS) {
    const indices = buckets[detail];
    if (indices.length === 0) continue;
    const geom = buildCanopyGeometry(detail);
    bakeVertexShading(geom, cfg.TREE_SHADING_STRENGTH);

    const mesh = new THREE.InstancedMesh(geom, canopyMaterial, indices.length);
    mesh.name = `tree-canopy-d${detail}`;
    mesh.renderOrder = RENDER_ORDERS.PARK_FOLIAGE;
    mesh.frustumCulled = false;
    mesh.visible = cfg.TREES_ENABLED;
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
      mesh.setColorAt(k, tmpColor);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    canopyRecords.push({ detail, mesh, placementOrder: indices });
  }

  // Trunk: one shared mesh, one instance per tree in placement order.
  const trunkMesh = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, totalTrees);
  trunkMesh.name = 'tree-trunk';
  trunkMesh.renderOrder = RENDER_ORDERS.PARK_FOLIAGE;
  trunkMesh.frustumCulled = false;
  trunkMesh.visible = cfg.TREES_ENABLED;

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
  group.visible = cfg.TREES_ENABLED;
  for (const rec of canopyRecords) group.add(rec.mesh);
  group.add(trunkMesh);

  function refresh(): void {
    const c = TREES.get();
    group.visible = c.TREES_ENABLED;
    for (const rec of canopyRecords) rec.mesh.visible = c.TREES_ENABLED;
    trunkMesh.visible = c.TREES_ENABLED;

    setColorFromHex(trunkMaterial.color, c.TREE_TRUNK_COLOR);
    setColorFromHex(oldColor, c.TREE_COLOR_OLD);
    setColorFromHex(newColor, c.TREE_COLOR_NEW);

    for (const rec of canopyRecords) {
      for (let k = 0; k < rec.placementOrder.length; k++) {
        perTreeColor(rec.placementOrder[k], tmpColor);
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

  return { group, refresh, dispose };
}
