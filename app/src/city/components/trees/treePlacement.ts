// city/components/trees/treePlacement.ts — commit-driven tree placement.
//
// One tree per commit. Trees are scattered across the world floor
// rectangle via a STRATIFIED GRID: the sampling region is divided
// into a uniform grid sized to hold roughly `treeTarget` candidates
// (capped at TREE_MAX_CELLS for massive-repo memory safety). Each
// cell contributes a single jittered candidate, which is then run
// through the same two rejection passes:
//   1. layout-rect collisions (rbush against inflated buildings + streets + paths)
//   2. density-falloff probabilistic rejection
// Accepted candidates are sorted by distance to the gem (ascending)
// and truncated to `treeTarget`; the i-th placement gets
// commitIndex = i (oldest commit closest to gem).
//
// Why stratified instead of pure rejection sampling: a random sampler
// has to keep retrying to fill `treeTarget` (up to ~2 million iterations
// for big repos with high rejection rates).
// A grid traverses every candidate position exactly once and avoids
// re-sampling the same regions, so total work is bounded by cell
// count — independent of how big commits.length gets.
//
// Determinism is anchored to the bbox dims so the same laid-out
// city always produces the same placement across reloads.

import RBush from 'rbush';
import * as THREE from 'three';
import { TREES } from '@/state/stores/settings/trees';
import { FOOTPRINT } from '@/state/stores/settings/footprint';
import { BUILDING_DIMENSIONS } from '@/state/stores/settings/buildings';
import { ISLAND } from '@/state/stores/settings/island';
import { getWorldBounds } from '../../utils/floorBounds';
import { buildTopPolygon, pointInIslandPolygon } from '../island/islandGeometry';
import { islandSeedFromBounds } from '../island';
import { StreetAxis } from '@/types';
import { gemAnchorXZ } from '../gem/anchor';
import type { Building, CityBbox, Street } from '@/types';
import type { IslandConfig } from '@/state/stores/settings/island';

// Rejection-sampling footprint half-size as a fraction of BUILDING_DIMENSIONS
// .MAX_WIDTH — a fixed placement-tuning constant, not user-tunable (it lived in
// the TREES settings store but was never exposed as a control).
const SCATTER_FOOTPRINT_FRAC_OF_MAX_WIDTH = 0.5;

// Baked placement-tuning constants (not user-tunable). EDGE_INSET: trees stop
// short of the plane edge by this % of the shorter axis. DENSITY_FALLOFF:
// clustering exponent toward the city — 0 = uniform spread; higher packs trees
// near the city and thins them toward the edge.
const TREE_EDGE_INSET_PERCENT = 1;
const TREE_DENSITY_FALLOFF = 0;

interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface TreePlacement {
  x: number;
  y: number;
  seed: number;
  /** Index into Manifest.commits. commitIndex 0 = oldest commit,
   *  placed closest to the gem; higher index = newer commit,
   *  placed farther out. */
  commitIndex: number;
}

/** The only layout fields placeTrees reads — building/street footprints, plus
 *  the optional bbox. The worker receives this slim shape instead of the full
 *  CityLayout (whose buildings/streets carry heavy file/dir payloads) so the
 *  postMessage structured-clone stays cheap. A full CityLayout is assignable. */
export interface LayoutGeometry {
  buildings: Pick<Building, 'x' | 'y' | 'w' | 'd'>[];
  streets: Pick<Street, 'x' | 'y' | 'length' | 'width' | 'orientation' | 'isRoot'>[];
  bbox?: CityBbox;
}

export interface PlaceTreesOptions {
  /** Number of trees to plant — one per commit. */
  commitCount: number;
  /** Vertical extent of the rendered scene (bbox.max.y − bbox.min.y),
   *  threaded through to worldBounds so small-but-tall cities get a
   *  buffer proportional to building height. Optional — defaults to 0. */
  cityHeight?: number;
  /** Optional override for island geometry config (used by the worker
   *  which can't read the main-thread store directly). When omitted,
   *  the live ISLAND_GEOMETRY store is read. Pass null to disable the
   *  polygon rejection pass (e.g. in non-island tests). */
  islandGeoOverride?: IslandConfig | null;
}

/** Hard ceiling on grid resolution. Caps total iterations + accepted
 *  placements + downstream instance buffers, so a multi-million-commit
 *  repo (e.g. the Linux kernel) doesn't OOM the renderer or stall the
 *  worker. 100k ≈ a 316×316 grid; well within sub-second placement
 *  even with full rejection passes. */
const TREE_MAX_CELLS = 100_000;

/** Per-target multiplier on the grid cell count. Oversampling absorbs
 *  rejection passes (layout collisions / gem buffer / density falloff)
 *  so the final accepted count still hits `treeTarget` when there's
 *  physical room. 4× is enough headroom for ~75% combined rejection.
 *  Independent of TREE_MAX_CELLS — the cap wins for huge repos. */
const TREE_CELL_OVERSAMPLE = 4;

/**
 * Mulberry32 — small PRNG with proper avalanche.
 */
function mulberry32(s: number): number {
  let t = (s + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (t ^ (t >>> 14)) >>> 0;
}

function u32ToUnit(u: number): number {
  return u / 0x100000000;
}

function bboxOfBuilding(b: Pick<Building, 'x' | 'y' | 'w' | 'd'>): Rect {
  return {
    minX: b.x - b.w / 2,
    minY: b.y - b.d / 2,
    maxX: b.x + b.w / 2,
    maxY: b.y + b.d / 2,
  };
}

function bboxOfStreet(s: Pick<Street, 'x' | 'y' | 'length' | 'width' | 'orientation'>): Rect {
  const halfLen = s.length / 2;
  const halfWid = s.width / 2;
  if (s.orientation === StreetAxis.X) {
    return {
      minX: s.x - halfLen,
      maxX: s.x + halfLen,
      minY: s.y - halfWid,
      maxY: s.y + halfWid,
    };
  }
  return {
    minX: s.x - halfWid,
    maxX: s.x + halfWid,
    minY: s.y - halfLen,
    maxY: s.y + halfLen,
  };
}

/**
 * Compute the scatter center — the gem position when the layout
 * has a root street; falls back to bbox center for layouts that
 * don't (mostly tests). Uses the shared gemAnchorXZ helper so the
 * scatter center stays in lockstep with the gem's actual world
 * position (gem.ts uses the same helper).
 */
function gemCenterFromLayout(layout: LayoutGeometry, bbox: CityBbox): { x: number; y: number } {
  const root = layout.streets.find((s) => s.isRoot);
  if (!root) return { x: bbox.cx, y: bbox.cy };
  return gemAnchorXZ(root);
}

export function placeTrees(
  layout: LayoutGeometry,
  bboxOverride?: CityBbox,
  options: PlaceTreesOptions = { commitCount: 0 }
): TreePlacement[] {
  const cfg = TREES.value;
  if (!cfg.ENABLED) return [];

  const bbox = bboxOverride ?? layout.bbox;
  if (!bbox) return [];

  const treeTarget = Math.max(0, options.commitCount | 0);
  if (treeTarget === 0) return [];

  const footprint = FOOTPRINT.value;
  const halo = footprint.ENABLED ? Math.max(0, footprint.HALO_WIDTH) : 0;

  // Build rbush of every layout rect, inflated by the halo.
  const rtree = new RBush<Rect>();
  const rects: Rect[] = [];
  const inflate = (r: Rect): Rect => ({
    minX: r.minX - halo,
    minY: r.minY - halo,
    maxX: r.maxX + halo,
    maxY: r.maxY + halo,
  });
  for (const b of layout.buildings) rects.push(inflate(bboxOfBuilding(b)));
  for (const s of layout.streets) rects.push(inflate(bboxOfStreet(s)));
  if (rects.length > 0) rtree.load(rects);
  const hasRects = rects.length > 0;

  const dims = BUILDING_DIMENSIONS.value;
  const halfFoot = (SCATTER_FOOTPRINT_FRAC_OF_MAX_WIDTH * dims.MAX_WIDTH) / 2;

  const bounds = getWorldBounds(bbox, options.cityHeight ?? 0);
  const center = gemCenterFromLayout(layout, bbox);

  // Expand sampling region to cover the island polygon's full bounding
  // box, not just the inscribed worldBounds rect. The polygon
  // circumscribes the rect (vertices at radius hypot(halfWidth, halfDepth)),
  // so its bbox is that radius on both axes. Without this expansion, the
  // polygon's "ears" past the rect corners get zero candidates and read
  // as empty zones on the island.
  //
  // Edge inset is handled by shrinking the polygon used in the rejection
  // test (see shrunkPolygon below), NOT by shrinking the sampling rect.
  //
  // The island polygon is bigger than the bounds rect: scaled by
  // sqrt(2)/cos(π/N) so it fully contains the rect's corners. The
  // sampling rect needs to match the polygon's axis-aligned bounding box
  // (i.e. the polygon's max X/Z extent) — otherwise tree candidates fill
  // only the smaller bounds rect, leaving the polygon's expanded edges
  // empty. Worst-case polygon vertex sits at halfWidth × baseScale ×
  // (1 + IRREGULARITY) (outward jitter), so sample to that extent.
  const sides = options.islandGeoOverride?.SIDES ?? ISLAND.value.SIDES;
  // Irregularity is now reductive (vertices shrink inward), so the polygon's
  // max extent is bounded by the unjittered baseScale — no (1 + irregularity)
  // expansion factor needed.
  const polygonScale = Math.SQRT2 / Math.cos(Math.PI / sides);
  const sampleHalfW = bounds.halfWidth * polygonScale;
  const sampleHalfD = bounds.halfDepth * polygonScale;

  // Density falloff: trees cluster near the city, fade out toward the
  // sampling region's edge. `maxFalloffDist` is the largest possible
  // distance from the city bbox within the sampling region — used to
  // normalize the per-candidate distance into [0,1].
  const falloffPower = TREE_DENSITY_FALLOFF;
  const worldMinX = bounds.cx - sampleHalfW;
  const worldMaxX = bounds.cx + sampleHalfW;
  const worldMinZ = bounds.cz - sampleHalfD;
  const worldMaxZ = bounds.cz + sampleHalfD;
  const dxLeft = Math.max(0, bbox.minX - worldMinX);
  const dxRight = Math.max(0, worldMaxX - bbox.maxX);
  const dyTop = Math.max(0, bbox.minY - worldMinZ);
  const dyBot = Math.max(0, worldMaxZ - bbox.maxY);
  const maxFalloffDist = Math.sqrt(Math.max(dxLeft, dxRight) ** 2 + Math.max(dyTop, dyBot) ** 2);
  const falloffActive = falloffPower > 0 && maxFalloffDist > 0;

  // Island polygon containment: build the same polygon that islandMesh
  // renders so we can reject candidates outside the visible silhouette.
  // options.islandGeoOverride === null disables the pass (non-island tests);
  // undefined means read the live store (main-thread / sync path).
  // The worker passes a snapshot via islandGeoOverride so it never touches
  // the main-thread store directly.
  //
  // Edge inset: each polygon vertex is pulled radially inward by insetFrac
  // so the rejection test naturally excludes trees within that margin of
  // the actual polygon edge. This gives visually-uniform clearance regardless
  // of IRREGULARITY (which makes edges sit at varying distances from origin).
  let islandPolygon: THREE.Vector3[] | null = null;
  if (options.islandGeoOverride !== null) {
    const islandGeo = options.islandGeoOverride ?? ISLAND.value;
    if (islandGeo.ENABLED) {
      const rawPolygon = buildTopPolygon({
        sides: islandGeo.SIDES,
        irregularity: islandGeo.IRREGULARITY,
        tiers: islandGeo.TIERS,
        depth: islandGeo.DEPTH,
        halfWidth: bounds.halfWidth,
        halfDepth: bounds.halfDepth,
        seed: islandSeedFromBounds(bounds),
        roundness: islandGeo.ROUNDNESS,
        grassThickness: islandGeo.GRASS_THICKNESS,
      });
      // Shrink every vertex radially inward by insetFrac so the rejection
      // polygon is uniformly inset from the actual island edge.
      const insetFrac = TREE_EDGE_INSET_PERCENT / 100;
      islandPolygon = rawPolygon.map((v) => {
        const r = Math.hypot(v.x, v.z);
        if (r < 1e-6) return v.clone();
        const newR = r * (1 - insetFrac);
        const scale = newR / r;
        return new THREE.Vector3(v.x * scale, v.y, v.z * scale);
      });
    }
  }

  // Master seed from bbox dims for determinism.
  let masterSeed = mulberry32(Math.round(bbox.minX * 1000));
  masterSeed = mulberry32(masterSeed ^ Math.round(bbox.minY * 1000));
  masterSeed = mulberry32(masterSeed ^ Math.round(bbox.maxX * 1000));
  masterSeed = mulberry32(masterSeed ^ Math.round(bbox.maxY * 1000));

  // Stratified grid: aim for ~TREE_CELL_OVERSAMPLE × treeTarget cells
  // (the extra cells absorb the three rejection passes below), capped
  // at TREE_MAX_CELLS so a Linux-sized repo can't blow up the worker.
  // Aspect ratio follows the sampling region.
  const samplingW = sampleHalfW * 2;
  const samplingD = sampleHalfD * 2;
  const desiredCells = Math.min(TREE_MAX_CELLS, Math.max(1, treeTarget) * TREE_CELL_OVERSAMPLE);
  const aspect = samplingW / Math.max(1e-6, samplingD);
  let cellsX = Math.max(1, Math.round(Math.sqrt(desiredCells * aspect)));
  let cellsZ = Math.max(1, Math.round(Math.sqrt(desiredCells / aspect)));
  // Trim back so the rounded grid never exceeds the cap.
  while (cellsX * cellsZ > TREE_MAX_CELLS) {
    if (cellsX >= cellsZ) cellsX--;
    else cellsZ--;
  }
  const cellW = samplingW / cellsX;
  const cellD = samplingD / cellsZ;
  const originX = bounds.cx - sampleHalfW;
  const originZ = bounds.cz - sampleHalfD;

  // Visit each grid cell exactly once. Each contributes a single
  // jittered candidate; the two rejection passes (layout, density
  // falloff) match the previous behavior.
  const accepted: { x: number; y: number; d2: number; seed: number }[] = [];
  for (let cz = 0; cz < cellsZ; cz++) {
    for (let cx = 0; cx < cellsX; cx++) {
      const baseSeed = (masterSeed ^ ((cz * cellsX + cx + 1) | 0)) | 0;
      const jx = u32ToUnit(mulberry32(baseSeed ^ 0x12345678));
      const jz = u32ToUnit(mulberry32(baseSeed ^ 0x9abcdef0));
      const x = originX + (cx + jx) * cellW;
      const y = originZ + (cz + jz) * cellD;

      if (hasRects) {
        const hits = rtree.search({
          minX: x - halfFoot,
          minY: y - halfFoot,
          maxX: x + halfFoot,
          maxY: y + halfFoot,
        });
        const overlaps = hits.some(
          (h) =>
            h.minX < x + halfFoot &&
            h.maxX > x - halfFoot &&
            h.minY < y + halfFoot &&
            h.maxY > y - halfFoot
        );
        if (overlaps) continue;
      }

      // Density falloff: reject probabilistically based on distance
      // from the city bbox. Inside the bbox dist=0 → always accept;
      // far away the acceptance probability drops as
      // (1 - dist/maxDist)^power.
      if (falloffActive) {
        const distX = Math.max(bbox.minX - x, 0, x - bbox.maxX);
        const distY = Math.max(bbox.minY - y, 0, y - bbox.maxY);
        const dist = Math.sqrt(distX * distX + distY * distY);
        const tnorm = Math.min(1, dist / maxFalloffDist);
        const acceptProb = Math.pow(1 - tnorm, falloffPower);
        const r = u32ToUnit(mulberry32(baseSeed ^ 0xfa110ff5));
        if (r > acceptProb) continue;
      }

      // Island polygon containment: reject candidates outside the visible
      // island silhouette. The polygon is built in LOCAL coords (centered
      // on origin) but (x, y) are WORLD coords (offset by bounds.cx/cz).
      // Shift the candidate back into the polygon's frame before testing.
      // treePlacement uses (x, y) for the XZ plane; the polygon uses (x, z).
      if (islandPolygon && !pointInIslandPolygon(x - bounds.cx, y - bounds.cz, islandPolygon))
        continue;

      const dx = x - center.x;
      const dy = y - center.y;
      accepted.push({ x, y, d2: dx * dx + dy * dy, seed: baseSeed });
    }
  }

  accepted.sort((a, b) => a.d2 - b.d2);

  // Reconcile physical positions (accepted cells) with the commit
  // count. Two paths:
  //   * accepted.length > treeTarget — we have more grid candidates
  //     than commits (the common 4× oversample case). Pick treeTarget
  //     positions evenly spaced across the sorted-by-distance list,
  //     so the forest spans the whole sampling region rather than
  //     collapsing into a disk near the gem. Each picked position
  //     gets commitIndex = i (oldest closest, newest farthest).
  //   * accepted.length < treeTarget — TREE_MAX_CELLS clamped us
  //     below commits.length (e.g. multi-million-commit repos). Every
  //     accepted position is used, but commitIndex stride-samples the
  //     commits array so the visible trees represent the full
  //     timeline instead of only the oldest few.
  const treesToPlace = Math.min(accepted.length, treeTarget);
  const placements: TreePlacement[] = [];
  if (treesToPlace === 0) return placements;
  const acceptedStride = (accepted.length - 1) / Math.max(1, treesToPlace - 1);
  const commitStride = (treeTarget - 1) / Math.max(1, treesToPlace - 1);
  for (let i = 0; i < treesToPlace; i++) {
    const acceptedIdx = Math.min(accepted.length - 1, Math.round(i * acceptedStride));
    const commitIdx = Math.min(treeTarget - 1, Math.round(i * commitStride));
    const c = accepted[acceptedIdx];
    placements.push({ x: c.x, y: c.y, seed: c.seed, commitIndex: commitIdx });
  }
  return placements;
}
