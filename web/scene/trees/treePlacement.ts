// scene/trees/treePlacement.ts — commit-driven tree placement.
//
// One tree per commit. Trees are scattered uniformly across the world
// floor rectangle (anchored at the bbox center + buffer via
// getWorldBounds), candidates that overlap a building/street/path
// are rejected, accepted candidates are sorted by distance to the gem
// (ascending), and the i-th placement gets commitIndex = i
// (oldest commit closest to gem).
//
// Determinism is anchored to the bbox dims so the same laid-out
// city always produces the same placement across reloads.

import RBush from 'rbush';
import { TREES } from '@/config/trees.js';
import { FOOTPRINT } from '@/config/footprint.js';
import { BUILDING_DIMENSIONS } from '@/config/building.js';
import { getWorldBounds } from '../worldBounds.js';
import { StreetAxis } from '@/types';
import type { Building, BuildingPath, CityBbox, CityLayout, Street } from '@/types';

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
}

/** Hard ceiling on candidate-sample iterations. The loop exits as
 *  soon as `commitCount` non-overlapping positions are accepted. */
const TREE_MAX_ATTEMPTS = 2_000_000;

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

  const insetFrac = cfg.EDGE_INSET_PERCENT / 100;
  const inset = Math.min(bounds.halfWidth, bounds.halfDepth) * insetFrac;
  const sampleHalfW = Math.max(0, bounds.halfWidth - inset);
  const sampleHalfD = Math.max(0, bounds.halfDepth - inset);

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

  // Master seed from bbox dims for determinism.
  let masterSeed = mulberry32(Math.round(bbox.minX * 1000));
  masterSeed = mulberry32(masterSeed ^ Math.round(bbox.minY * 1000));
  masterSeed = mulberry32(masterSeed ^ Math.round(bbox.maxX * 1000));
  masterSeed = mulberry32(masterSeed ^ Math.round(bbox.maxY * 1000));

  // Sample across the world rectangle, applying density falloff and
  // rect-collision rejection, until we have `treeTarget` non-overlapping
  // positions. Then sort by distance to gem and assign commitIndex by
  // order (oldest = closest).
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

    // Density falloff: reject probabilistically based on distance from
    // the city bbox. Inside the bbox dist=0 → always accept; far away
    // the acceptance probability drops as (1 - dist/maxDist)^power.
    if (falloffActive) {
      const distX = Math.max(bbox.minX - x, 0, x - bbox.maxX);
      const distY = Math.max(bbox.minY - y, 0, y - bbox.maxY);
      const dist = Math.sqrt(distX * distX + distY * distY);
      const tnorm = Math.min(1, dist / maxFalloffDist);
      const acceptProb = Math.pow(1 - tnorm, falloffPower);
      const r = u32ToUnit(mulberry32(baseSeed ^ 0xfa110ff5));
      if (r > acceptProb) continue;
    }

    const dx = x - center.x;
    const dy = y - center.y;
    accepted.push({ x, y, d2: dx * dx + dy * dy, seed: baseSeed });
  }

  accepted.sort((a, b) => a.d2 - b.d2);

  const placements: TreePlacement[] = [];
  for (let i = 0; i < accepted.length; i++) {
    const c = accepted[i];
    placements.push({ x: c.x, y: c.y, seed: c.seed, commitIndex: i });
  }
  return placements;
}
