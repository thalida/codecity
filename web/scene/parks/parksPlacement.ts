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
import { getWorldFloorHalfSize } from './worldBounds.js';
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
}

/** Oversampling multiplier when generating candidate tree positions.
 *  Higher = denser inner-ring fill before truncating. 8 is plenty
 *  for visually uniform fills. */
const TREE_OVERSAMPLE_FACTOR = 8;

/** Floor on the number of candidate samples — even a 1-commit repo
 *  gets a varied position pool. */
const TREE_MIN_ATTEMPTS = 10_000;

/** Hard ceiling — on a million-commit repo, we still cap the worker.
 *  When commitCount × OVERSAMPLE exceeds this, fewer trees fit than
 *  commits exist; the newest commits drop off (oldest stay rooted). */
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

/**
 * In-place Hoare-style quickselect: partitions `arr` so that the
 * `k` elements with the smallest `key(item)` end up at indices
 * `0..k-1` (in arbitrary internal order). Elements at indices
 * `k..arr.length-1` are larger-or-equal. O(N) average, O(N²)
 * worst case (Lomuto partition with random pivot mitigates).
 *
 * Used by the tree pass to extract "the N closest candidates to
 * the gem" from up to 2M oversampled points without paying for a
 * full sort. After selection the caller still sorts the kept
 * slice (cheap — at most commitCount items).
 */
function _quickselect<T>(arr: T[], k: number, key: (t: T) => number): void {
  if (k <= 0 || arr.length <= k) return;
  let lo = 0;
  let hi = arr.length - 1;
  while (lo < hi) {
    // Pick a random pivot to dodge adversarial inputs.
    const pivotIdx = lo + ((Math.random() * (hi - lo + 1)) | 0);
    const pivotVal = key(arr[pivotIdx]);
    // Swap pivot to the end.
    [arr[pivotIdx], arr[hi]] = [arr[hi], arr[pivotIdx]];
    let store = lo;
    for (let i = lo; i < hi; i++) {
      if (key(arr[i]) < pivotVal) {
        [arr[i], arr[store]] = [arr[store], arr[i]];
        store++;
      }
    }
    // Swap pivot into its final position.
    [arr[store], arr[hi]] = [arr[hi], arr[store]];
    if (store === k) return;
    if (store < k) lo = store + 1;
    else hi = store - 1;
  }
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

  // World-anchored square. The world floor and the tree square share
  // the same bounds, so trees never sit outside the visible ground.
  const half = getWorldFloorHalfSize();
  const center = gemCenterFromLayout(layout, bbox);

  // Master seed from the bbox dims so the same layout always
  // produces the same parks across reloads.
  let masterSeed = mulberry32(Math.round(bbox.minX * 1000));
  masterSeed = mulberry32(masterSeed ^ Math.round(bbox.minY * 1000));
  masterSeed = mulberry32(masterSeed ^ Math.round(bbox.maxX * 1000));
  masterSeed = mulberry32(masterSeed ^ Math.round(bbox.maxY * 1000));

  const placements: ParkPlacement[] = [];

  // ── Tree pass: oversample → reject overlaps → sort by distance to
  //    gem → truncate to commitCount. ──────────────────────────────
  const treeTarget = Math.max(0, options.commitCount | 0);
  if (treeTarget > 0) {
    let attempts = treeTarget * TREE_OVERSAMPLE_FACTOR;
    if (attempts < TREE_MIN_ATTEMPTS) attempts = TREE_MIN_ATTEMPTS;
    if (attempts > TREE_MAX_ATTEMPTS) attempts = TREE_MAX_ATTEMPTS;

    const candidates: {
      x: number; y: number; d2: number; seed: number;
    }[] = [];

    for (let i = 0; i < attempts; i++) {
      const baseSeed = (masterSeed ^ (i + 1)) | 0;
      const xUnit = u32ToUnit(mulberry32(baseSeed ^ 0x12345678));
      const yUnit = u32ToUnit(mulberry32(baseSeed ^ 0x9abcdef0));
      const x = center.x + (xUnit * 2 - 1) * half;
      const y = center.y + (yUnit * 2 - 1) * half;

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
      candidates.push({ x, y, d2: dx * dx + dy * dy, seed: baseSeed });
    }

    // Quickselect the closest `treeTarget` candidates by d², then
    // sort just that slice so commitIndex maps to age rank
    // (innermost = oldest).
    _quickselect(candidates, treeTarget, (c) => c.d2);
    const accepted = candidates.length > treeTarget
      ? candidates.slice(0, treeTarget)
      : candidates;
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
          const x = center.x + (xUnit * 2 - 1) * half;
          const y = center.y + (yUnit * 2 - 1) * half;

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
