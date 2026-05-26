// scene/bushes/bushPlacement.ts — decorative bush scatter placement.
//
// Bushes are not commit-driven. They use a density-gradient approach:
// candidates sample the world rectangle uniformly, rejected from
// overlapping layout rects (inflated by footprint halo), and further
// thinned near the city by a distance-based density gradient.
//
// Only runs when BUSHES.BUSHES_ENABLED is true.

import RBush from 'rbush';
import { BUSHES } from '@/config/components/bushes.js';
import { FOOTPRINT } from '@/config/components/footprint.js';
import { BUILDING_DIMENSIONS } from '@/config/components/buildings.js';
import { CAMERA_PERSPECTIVE } from '@/config/system/cameraRig.js';
import { TREES } from '@/config/components/trees.js';
import { getWorldBounds } from '../../layout/worldBounds.js';
import { StreetAxis } from '@/types';
import type { Building, BuildingPath, CityBbox, CityLayout, Street } from '@/types';

interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface BushPlacement {
  x: number;
  y: number;
  seed: number;
}

export interface PlaceBushesOptions {
  /** Vertical extent of the rendered scene, for worldBounds buffer. */
  cityHeight?: number;
}

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
    return { minX: s.x - halfLen, maxX: s.x + halfLen, minY: s.y - halfWid, maxY: s.y + halfWid };
  }
  return { minX: s.x - halfWid, maxX: s.x + halfWid, minY: s.y - halfLen, maxY: s.y + halfLen };
}

function distToNearestRect(x: number, y: number, rbushTree: RBush<Rect>, cap: number): number {
  const hits = rbushTree.search({
    minX: x - cap,
    minY: y - cap,
    maxX: x + cap,
    maxY: y + cap,
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

/** City-density fraction used for bush scatter — 30% thinning near
 *  the city, 100% in the outskirts. */
const BUSH_CITY_DENSITY = 0.3;
/** Gradient reach as a fraction of CAMERA_PERSPECTIVE.FAR. */
const BUSH_GRADIENT_REACH_FRAC = 0.4;
/** Number of scatter attempts (scales with density). */
const BUSH_SCATTER_ATTEMPTS = 50_000;

export function placeBushes(
  layout: CityLayout,
  bboxOverride?: CityBbox,
  options: PlaceBushesOptions = {}
): BushPlacement[] {
  const cfg = BUSHES.get();
  if (!cfg.BUSHES_ENABLED) return [];

  const bbox = bboxOverride ?? layout.bbox;
  if (!bbox) return [];

  const footprint = FOOTPRINT.get();
  const halo = footprint.ENABLED ? Math.max(0, footprint.HALO_WIDTH) : 0;

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
  for (const p of layout.paths) rects.push(inflate(bboxOfPath(p)));
  if (rects.length > 0) rtree.load(rects);
  const hasRects = rects.length > 0;

  const dims = BUILDING_DIMENSIONS.get();
  // Re-use TREES.SCATTER_FOOTPRINT_FRAC_OF_MAX_WIDTH for rejection
  // footprint so bushes respect the same layout-buffer as trees.
  const treesCfg = TREES.get();
  const halfFoot = (treesCfg.SCATTER_FOOTPRINT_FRAC_OF_MAX_WIDTH * dims.MAX_WIDTH) / 2;

  const bounds = getWorldBounds(bbox, options.cityHeight ?? 0);

  // Use the same inset logic as trees for the sampling region.
  const insetFrac = treesCfg.EDGE_INSET_PERCENT / 100;
  const inset = Math.min(bounds.halfWidth, bounds.halfDepth) * insetFrac;
  const sampleHalfW = Math.max(0, bounds.halfWidth - inset);
  const sampleHalfD = Math.max(0, bounds.halfDepth - inset);

  // Master seed — use a different salt from tree placement so the
  // streams don't correlate.
  let masterSeed = mulberry32(Math.round(bbox.minX * 1000));
  masterSeed = mulberry32(masterSeed ^ Math.round(bbox.minY * 1000));
  masterSeed = mulberry32(masterSeed ^ Math.round(bbox.maxX * 1000));
  masterSeed = mulberry32(masterSeed ^ Math.round(bbox.maxY * 1000));

  const gradientReach = Math.max(1, BUSH_GRADIENT_REACH_FRAC * CAMERA_PERSPECTIVE.get().FAR);

  const placements: BushPlacement[] = [];

  for (let i = 0; i < BUSH_SCATTER_ATTEMPTS; i++) {
    const baseSeed = (masterSeed ^ 0x70a070a0 ^ (i + 1)) | 0;
    const xUnit = u32ToUnit(mulberry32(baseSeed ^ 0x12345678));
    const yUnit = u32ToUnit(mulberry32(baseSeed ^ 0x9abcdef0));
    const accUnit = u32ToUnit(mulberry32(baseSeed ^ 0xa5a5a5a5));
    const x = bounds.cx + (xUnit * 2 - 1) * sampleHalfW;
    const y = bounds.cz + (yUnit * 2 - 1) * sampleHalfD;

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

    let localDensity: number;
    if (!hasRects) {
      localDensity = 1.0;
    } else {
      const d = distToNearestRect(x, y, rtree, gradientReach);
      const t = Math.min(1, d / gradientReach);
      localDensity = BUSH_CITY_DENSITY + (1.0 - BUSH_CITY_DENSITY) * t;
    }
    if (accUnit > localDensity) continue;

    placements.push({ x, y, seed: baseSeed });
  }

  return placements;
}
