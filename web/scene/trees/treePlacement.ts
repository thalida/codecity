// scene/trees/treePlacement.ts — commit-driven tree placement.
//
// One tree per commit. Trees are scattered across the world floor
// rectangle via a STRATIFIED GRID: the sampling region is divided
// into a uniform grid sized to hold roughly `treeTarget` candidates
// (capped at TREE_MAX_CELLS for massive-repo memory safety). Each
// cell contributes a single jittered candidate, which is then run
// through the same three rejection passes:
//   1. layout-rect collisions (rbush against inflated buildings + streets + paths)
//   2. gem no-tree buffer
//   3. density-falloff probabilistic rejection
// Accepted candidates are sorted by distance to the gem (ascending)
// and truncated to `treeTarget`; the i-th placement gets
// commitIndex = i (oldest commit closest to gem).
//
// Why stratified instead of pure rejection sampling: a random sampler
// has to keep retrying to fill `treeTarget` (the old code grinded up
// to 2 million iterations for big repos with high rejection rates).
// A grid traverses every candidate position exactly once and avoids
// re-sampling the same regions, so total work is bounded by cell
// count — independent of how big commits.length gets.
//
// Determinism is anchored to the bbox dims so the same laid-out
// city always produces the same placement across reloads.

import RBush from 'rbush';
import * as THREE from 'three';
import { TREES } from '@/config/trees.js';
import { FOOTPRINT } from '@/config/footprint.js';
import { BUILDING_DIMENSIONS } from '@/config/building.js';
import { GEM_SIZING } from '@/config/gem.js';
import { ISLAND_GEOMETRY } from '@/config/island.js';
import { getWorldBounds } from '../worldBounds.js';
import {
  buildTopPolygon,
  pointInIslandPolygon,
} from '../island/islandGeometry.js';
import { islandSeedFromBounds } from '../island/islandMesh.js';
import { StreetAxis } from '@/types';
import type { Building, BuildingPath, CityBbox, CityLayout, Street } from '@/types';
import type { IslandGeometryConfig } from '@/config/island.js';

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
  islandGeoOverride?: IslandGeometryConfig | null;
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

function bboxOfBuilding(b: Building): Rect {
  return {
    minX: b.x - b.w / 2,
    minY: b.y - b.d / 2,
    maxX: b.x + b.w / 2,
    maxY: b.y + b.d / 2,
  };
}

function bboxOfPath(p: BuildingPath): Rect {
  return {
    minX: p.x - p.w / 2,
    minY: p.y - p.d / 2,
    maxX: p.x + p.w / 2,
    maxY: p.y + p.d / 2,
  };
}

function bboxOfStreet(s: Street): Rect {
  const halfLen = s.length / 2;
  const halfWid = s.width / 2;
  if (s.orientation === StreetAxis.X) {
    return {
      minX: s.x - halfLen, maxX: s.x + halfLen,
      minY: s.y - halfWid, maxY: s.y + halfWid,
    };
  }
  return {
    minX: s.x - halfWid, maxX: s.x + halfWid,
    minY: s.y - halfLen, maxY: s.y + halfLen,
  };
}

/**
 * Compute the scatter center — the gem position when the layout
 * has a root street; falls back to bbox center for layouts that
 * don't (mostly tests).
 */
function gemCenterFromLayout(
  layout: CityLayout,
  bbox: CityBbox,
): { x: number; y: number } {
  const root = layout.streets.find((s) => s.isRoot);
  if (!root) return { x: bbox.cx, y: bbox.cy };
  if (root.orientation === StreetAxis.X) {
    return {
      x: root.x - root.length / 2 + root.width / 2,
      y: root.y,
    };
  }
  return {
    x: root.x,
    y: root.y - root.length / 2 + root.width / 2,
  };
}

export function placeTrees(
  layout: CityLayout,
  bboxOverride?: CityBbox,
  options: PlaceTreesOptions = { commitCount: 0 },
): TreePlacement[] {
  const cfg = TREES.get();
  if (!cfg.TREES_ENABLED) return [];

  const bbox = bboxOverride ?? layout.bbox;
  if (!bbox) return [];

  const treeTarget = Math.max(0, options.commitCount | 0);
  if (treeTarget === 0) return [];

  const footprint = FOOTPRINT.get();
  const halo = footprint.ENABLED ? Math.max(0, footprint.HALO_WIDTH) : 0;

  // Build rbush of every layout rect, inflated by the halo.
  const rtree = new RBush<Rect>();
  const rects: Rect[] = [];
  const inflate = (r: Rect): Rect => ({
    minX: r.minX - halo, minY: r.minY - halo,
    maxX: r.maxX + halo, maxY: r.maxY + halo,
  });
  for (const b of layout.buildings) rects.push(inflate(bboxOfBuilding(b)));
  for (const s of layout.streets) rects.push(inflate(bboxOfStreet(s)));
  for (const p of layout.paths) rects.push(inflate(bboxOfPath(p)));
  if (rects.length > 0) rtree.load(rects);
  const hasRects = rects.length > 0;

  const dims = BUILDING_DIMENSIONS.get();
  const halfFoot = (cfg.SCATTER_FOOTPRINT_FRAC_OF_MAX_WIDTH * dims.MAX_WIDTH) / 2;

  const bounds = getWorldBounds(bbox, options.cityHeight ?? 0);
  const center = gemCenterFromLayout(layout, bbox);

  // Gem buffer: hard rejection of any candidate within this radius of
  // the gem center. Squared once for cheap comparison in the loop.
  const gemBufferRadius = Math.max(0, GEM_SIZING.get().TREE_BUFFER_RADIUS);
  const gemBufferR2 = gemBufferRadius * gemBufferRadius;

  // Expand sampling region to cover the island polygon's full bounding
  // box, not just the inscribed worldBounds rect. The polygon
  // circumscribes the rect (vertices at radius hypot(halfWidth, halfDepth)),
  // so its bbox is that radius on both axes. Without this expansion, the
  // polygon's "ears" past the rect corners get zero candidates and read
  // as empty zones on the island.
  const polygonRadius = Math.hypot(bounds.halfWidth, bounds.halfDepth);
  const insetFrac = cfg.EDGE_INSET_PERCENT / 100;
  const inset = polygonRadius * insetFrac;
  const sampleHalfW = Math.max(0, polygonRadius - inset);
  const sampleHalfD = Math.max(0, polygonRadius - inset);

  // Density falloff: trees cluster near the city, fade out toward the
  // sampling region's edge. `maxFalloffDist` is the largest possible
  // distance from the city bbox within the sampling region — used to
  // normalize the per-candidate distance into [0,1].
  const falloffPower = Math.max(0, cfg.TREE_DENSITY_FALLOFF);
  const worldMinX = bounds.cx - sampleHalfW;
  const worldMaxX = bounds.cx + sampleHalfW;
  const worldMinZ = bounds.cz - sampleHalfD;
  const worldMaxZ = bounds.cz + sampleHalfD;
  const dxLeft = Math.max(0, bbox.minX - worldMinX);
  const dxRight = Math.max(0, worldMaxX - bbox.maxX);
  const dyTop = Math.max(0, bbox.minY - worldMinZ);
  const dyBot = Math.max(0, worldMaxZ - bbox.maxY);
  const maxFalloffDist = Math.sqrt(
    Math.max(dxLeft, dxRight) ** 2 + Math.max(dyTop, dyBot) ** 2,
  );
  const falloffActive = falloffPower > 0 && maxFalloffDist > 0;

  // Island polygon containment: build the same polygon that islandMesh
  // renders so we can reject candidates outside the visible silhouette.
  // options.islandGeoOverride === null disables the pass (non-island tests);
  // undefined means read the live store (main-thread / sync path).
  // The worker passes a snapshot via islandGeoOverride so it never touches
  // the main-thread store directly.
  let islandPolygon: THREE.Vector3[] | null = null;
  if (options.islandGeoOverride !== null) {
    const islandGeo = options.islandGeoOverride ?? ISLAND_GEOMETRY.get();
    if (islandGeo.ENABLED) {
      islandPolygon = buildTopPolygon({
        sides: islandGeo.SIDES,
        irregularity: islandGeo.IRREGULARITY,
        tiers: islandGeo.TIERS,
        depth: islandGeo.DEPTH,
        halfWidth: bounds.halfWidth,
        halfDepth: bounds.halfDepth,
        seed: islandSeedFromBounds(bounds),
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
  const desiredCells = Math.min(
    TREE_MAX_CELLS,
    Math.max(1, treeTarget) * TREE_CELL_OVERSAMPLE,
  );
  const aspect = samplingW / Math.max(1e-6, samplingD);
  let cellsX = Math.max(1, Math.round(Math.sqrt(desiredCells * aspect)));
  let cellsZ = Math.max(1, Math.round(Math.sqrt(desiredCells / aspect)));
  // Trim back so the rounded grid never exceeds the cap.
  while (cellsX * cellsZ > TREE_MAX_CELLS) {
    if (cellsX >= cellsZ) cellsX--; else cellsZ--;
  }
  const cellW = samplingW / cellsX;
  const cellD = samplingD / cellsZ;
  const originX = bounds.cx - sampleHalfW;
  const originZ = bounds.cz - sampleHalfD;

  // Visit each grid cell exactly once. Each contributes a single
  // jittered candidate; the three rejection passes (layout, gem
  // buffer, density falloff) match the previous behavior.
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
          minX: x - halfFoot, minY: y - halfFoot,
          maxX: x + halfFoot, maxY: y + halfFoot,
        });
        const overlaps = hits.some((h) =>
          h.minX < x + halfFoot && h.maxX > x - halfFoot &&
          h.minY < y + halfFoot && h.maxY > y - halfFoot,
        );
        if (overlaps) continue;
      }

      // Gem buffer: hard-reject candidates inside the no-tree halo
      // around the gem. Skipped when the buffer is 0.
      if (gemBufferR2 > 0) {
        const gdx = x - center.x;
        const gdy = y - center.y;
        if (gdx * gdx + gdy * gdy < gemBufferR2) continue;
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
      // island silhouette. The polygon is the same one islandMesh builds for
      // the top cap, so accepted trees always sit on grass.
      // NOTE: treePlacement uses (x, y) for the XZ plane; the polygon uses
      // (x, z). We pass (x, y) as (px, pz) since both represent world XZ.
      if (islandPolygon && !pointInIslandPolygon(x, y, islandPolygon)) continue;

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
    const acceptedIdx = Math.min(
      accepted.length - 1,
      Math.round(i * acceptedStride),
    );
    const commitIdx = Math.min(
      treeTarget - 1,
      Math.round(i * commitStride),
    );
    const c = accepted[acceptedIdx];
    placements.push({ x: c.x, y: c.y, seed: c.seed, commitIndex: commitIdx });
  }
  return placements;
}
