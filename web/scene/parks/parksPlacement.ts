// scene/parks/parksPlacement.ts — placement for commit-driven trees
// and decorative bushes/flowers.
//
// Trees: one per commit. Number of trees = options.commitCount (the
// scanner's Manifest.commits.length). Trees are scattered uniformly
// in a square anchored at the gem (matches the world floor's
// bounds via worldBounds.getWorldFloorHalfSize), candidates that
// overlap a building/street/path are rejected, accepted candidates
// are sorted by distance to the gem (ascending), and the closest N
// are taken (where N = commitCount). The i-th placement gets
// commitIndex = i so the renderer can map it to commits[i] (oldest
// closest to gem).
//
// Bushes / flowers: separate decorative pass. Only runs when at
// least one of PARKS_PALETTE.BUSHES_ENABLED / FLOWERS_ENABLED is
// true. Uses the existing density-gradient logic (CITY_DENSITY,
// GRADIENT_REACH) for scatter density. Currently 30% city-thinned,
// renormalized mix between bush/flower based on which are enabled.
//
// Determinism is anchored to the bbox dims so the same laid-out
// city always produces the same parks across reloads.

import RBush from 'rbush';
import { PARKS, PARKS_PALETTE } from '@/config/parks.js';
import { CAMERA_PERSPECTIVE } from '@/config/view.js';
import { FOOTPRINT } from '@/config/footprint.js';
import { BUILDING_DIMENSIONS } from '@/config/building.js';
import { getWorldBounds } from './worldBounds.js';
import { StreetAxis } from '@/types';
import type { Building, BuildingPath, CityBbox, CityLayout, Street } from '@/types';

interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export type ParkPlacementKind = 'tree' | 'bush' | 'flower-cluster';

export interface ParkPlacement {
  x: number;
  y: number;
  seed: number;
  kind: ParkPlacementKind;
  treeCount: number;
  bushCount: number;
  flowerCount: number;
  /** Index into Manifest.commits for tree placements; undefined for
   *  bush/flower placements. Renderer uses this for future age/width
   *  encoding. */
  commitIndex?: number;
}

export interface PlaceParksOptions {
  /** Number of trees to plant — one per commit. Tree placements are
   *  sorted closest-to-gem first; commitIndex i maps to the i-th
   *  closest tree (= i-th oldest commit, matching the chronological-
   *  outward planting order). */
  commitCount: number;
  /** Vertical extent of the rendered scene (bbox.max.y − bbox.min.y),
   *  threaded through to worldBounds so small-but-tall cities get a
   *  buffer proportional to building height. Optional — defaults to
   *  0 (no contribution), in which case buffer scales only with the
   *  city's XZ extent. */
  cityHeight?: number;
}

/** Hard ceiling on candidate-sample iterations. The loop exits as
 *  soon as `commitCount` non-overlapping positions are accepted —
 *  this cap only matters when rejection rate is extreme (city
 *  covers most of the plane) or commitCount is enormous. At 2M
 *  iterations the worker still completes in a fraction of a
 *  second. */
const TREE_MAX_ATTEMPTS = 2_000_000;

/**
 * Mulberry32 — small PRNG with proper avalanche. Single call returns
 * a u32 from a u32 input; outputs of `mulberry32(s ^ saltA)` and
 * `mulberry32(s ^ saltB)` are statistically independent for distinct
 * salts.
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
 * Compute the scatter center — the world-space point the tree
 * square is built around. Uses the gem position (the closed end of
 * the root street, same way cityScene computes it) when the layout
 * has a root street; falls back to bbox center for layouts that
 * don't (mostly tests). All coordinates here are in the placement's
 * 2D (x, y) frame — `y` is what three.js calls `z` at render time.
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

function countsForKind(
  kind: ParkPlacementKind,
  flowersPerBush: number,
  flowersPerCluster: number,
): { treeCount: number; bushCount: number; flowerCount: number } {
  switch (kind) {
    case 'tree':           return { treeCount: 1, bushCount: 0, flowerCount: 0 };
    case 'bush':           return { treeCount: 0, bushCount: 1, flowerCount: flowersPerBush };
    case 'flower-cluster': return { treeCount: 0, bushCount: 0, flowerCount: flowersPerCluster };
  }
}

/**
 * Distance from (x, y) to the nearest layout rect, OR `cap` if no
 * rect is within `cap`. Implemented as an expanding rbush query
 * with two stops: a `cap`-radius query first; if hits, scan their
 * point-to-rect distances and return the min.
 */
function distToNearestRect(
  x: number, y: number,
  rbushTree: RBush<Rect>,
  cap: number,
): number {
  const hits = rbushTree.search({
    minX: x - cap, minY: y - cap,
    maxX: x + cap, maxY: y + cap,
  });
  if (hits.length === 0) return cap;
  let min = cap;
  for (const r of hits) {
    const dx = Math.max(r.minX - x, 0, x - r.maxX);
    const dy = Math.max(r.minY - y, 0, y - r.maxY);
    const d = Math.hypot(dx, dy);
    if (d < min) min = d;
  }
  return min;
}

export function placeParks(
  layout: CityLayout,
  bboxOverride?: CityBbox,
  options: PlaceParksOptions = { commitCount: 0 },
): ParkPlacement[] {
  const cfg = PARKS.get();
  const palette = PARKS_PALETTE.get();
  if (!cfg.ENABLED) return [];

  const bbox = bboxOverride ?? layout.bbox;
  if (!bbox) return [];

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

  // World-anchored rectangle. The world floor and the tree scatter region
  // share the same bounds (bbox-centered + buffer), so trees never sit
  // outside the visible ground.
  const bounds = getWorldBounds(bbox, options.cityHeight ?? 0);
  const center = gemCenterFromLayout(layout, bbox);

  // Inset the sampling extent so foliage stops short of the plane
  // edge — leaves a visible bare-ground margin around the world.
  // A single absolute inset (min half-extent × fraction) guarantees
  // the bare-ground margin is the SAME width on all four sides of a
  // rectangular plane (e.g. an 80000 × 3000 plane still gets a
  // symmetric margin, not 3200u left/right and 120u top/bottom).
  const insetFrac = cfg.EDGE_INSET_PERCENT / 100;
  const inset = Math.min(bounds.halfWidth, bounds.halfDepth) * insetFrac;
  const sampleHalfW = Math.max(0, bounds.halfWidth - inset);
  const sampleHalfD = Math.max(0, bounds.halfDepth - inset);

  // Master seed from the bbox dims so the same layout always
  // produces the same parks across reloads.
  let masterSeed = mulberry32(Math.round(bbox.minX * 1000));
  masterSeed = mulberry32(masterSeed ^ Math.round(bbox.minY * 1000));
  masterSeed = mulberry32(masterSeed ^ Math.round(bbox.maxX * 1000));
  masterSeed = mulberry32(masterSeed ^ Math.round(bbox.maxY * 1000));

  const placements: ParkPlacement[] = [];

  // ── Tree pass: sample uniformly across the world rectangle until
  //    we have `commitCount` non-overlapping positions, THEN sort
  //    those positions by distance to the gem and assign
  //    commitIndex by order.
  //
  //    Why this order: uniform sampling stops at exactly N accepted
  //    candidates, so the N positions are evenly distributed across
  //    the entire plane (trees fill the world, not just a circle
  //    around the gem). Sorting after-the-fact then maps oldest
  //    commit (commitIndex 0) to the position closest to the gem,
  //    newest commit to the position farthest from the gem. Both
  //    properties are preserved: plane-fill AND chronological-
  //    outward growth.
  //
  //    Earlier versions oversampled then took the CLOSEST N — that
  //    correctly preserved chronology but clustered tightly around
  //    the gem on huge planes (e.g. React's 80k × 3k rectangle with
  //    ~17k commits packed into a ~5k-unit radius). ─────────────
  const treeTarget = Math.max(0, options.commitCount | 0);
  if (treeTarget > 0) {
    const accepted: { x: number; y: number; d2: number; seed: number }[] = [];
    for (let i = 0; i < TREE_MAX_ATTEMPTS && accepted.length < treeTarget; i++) {
      const baseSeed = (masterSeed ^ (i + 1)) | 0;
      const xUnit = u32ToUnit(mulberry32(baseSeed ^ 0x12345678));
      const yUnit = u32ToUnit(mulberry32(baseSeed ^ 0x9abcdef0));
      const x = bounds.cx + (xUnit * 2 - 1) * sampleHalfW;
      const y = bounds.cz + (yUnit * 2 - 1) * sampleHalfD;

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

      const dx = x - center.x;
      const dy = y - center.y;
      accepted.push({ x, y, d2: dx * dx + dy * dy, seed: baseSeed });
    }

    accepted.sort((a, b) => a.d2 - b.d2);
    for (let i = 0; i < accepted.length; i++) {
      const c = accepted[i];
      placements.push({
        x: c.x,
        y: c.y,
        seed: c.seed,
        kind: 'tree',
        treeCount: 1,
        bushCount: 0,
        flowerCount: 0,
        commitIndex: i,
      });
    }
  }

  // ── Bush + flower pass: only when at least one is enabled.
  //    Uses the original density gradient logic for variety. ──────
  if (palette.BUSHES_ENABLED || palette.FLOWERS_ENABLED) {
    const density = Math.max(0, Math.min(1, cfg.DENSITY_PERCENT / 100));
    if (density > 0) {
      const cityDensity = Math.max(0, Math.min(1, cfg.CITY_DENSITY_PERCENT / 100));
      const gradientReach = Math.max(
        1, (cfg.GRADIENT_REACH_PERCENT / 100) * CAMERA_PERSPECTIVE.get().FAR,
      );

      // Renormalize mix to whatever is enabled.
      const bushFrac = palette.BUSHES_ENABLED ? cfg.MIX_BUSH_FRAC : 0;
      const flowerFrac = palette.FLOWERS_ENABLED ? cfg.MIX_FLOWER_FRAC : 0;
      const totalFrac = bushFrac + flowerFrac;
      if (totalFrac > 0) {
        const bushShare = bushFrac / totalFrac;

        // Scale attempt count by density so low density doesn't burn CPU.
        const decoAttempts = Math.ceil(50_000 * density);

        for (let i = 0; i < decoAttempts; i++) {
          // Use a separate salt so deco candidates don't collide
          // with tree candidates' seed stream.
          const baseSeed = (masterSeed ^ 0x70a070a0 ^ (i + 1)) | 0;
          const xUnit = u32ToUnit(mulberry32(baseSeed ^ 0x12345678));
          const yUnit = u32ToUnit(mulberry32(baseSeed ^ 0x9abcdef0));
          const kUnit = u32ToUnit(mulberry32(baseSeed ^ 0xfedcba98));
          const accUnit = u32ToUnit(mulberry32(baseSeed ^ 0xa5a5a5a5));
          const x = bounds.cx + (xUnit * 2 - 1) * sampleHalfW;
          const y = bounds.cz + (yUnit * 2 - 1) * sampleHalfD;

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

          let localDensity: number;
          if (!hasRects) {
            localDensity = 1.0;
          } else {
            const d = distToNearestRect(x, y, rtree, gradientReach);
            const t = Math.min(1, d / gradientReach);
            localDensity = cityDensity + (1.0 - cityDensity) * t;
          }
          if (accUnit > localDensity) continue;

          const kind: ParkPlacementKind = kUnit < bushShare ? 'bush' : 'flower-cluster';
          const counts = countsForKind(kind, cfg.FLOWERS_PER_BUSH, cfg.FLOWERS_PER_CLUSTER);
          placements.push({ x, y, seed: baseSeed, kind, ...counts });
        }
      }
    }
  }

  return placements;
}
