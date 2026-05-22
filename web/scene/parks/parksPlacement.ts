// scene/parks/parksPlacement.ts — unified random-scatter foliage
// placement across the entire visible ground plane.
//
// Sampling: polar (theta, r) with r = sqrt(uniform) × planeRadius so
// points are uniform-in-area inside a circle of radius
// CAMERA_PERSPECTIVE.FAR around the city center. The circle covers
// the entire ground area the camera can see; no rectangular cutoffs.
//
// Per-candidate acceptance:
//   1. Reject if footprint overlaps a building / street / path
//      (rbush hit-test).
//   2. Compute d = distance from the candidate to the nearest layout
//      rect via an expanding rbush query.
//   3. Compute the local density modulator:
//        localDensity = DENSITY × lerp(CITY_DENSITY, 1.0,
//                                      min(d / gradientReach, 1.0))
//      where DENSITY and CITY_DENSITY are 0..1 (config / 100) and
//      gradientReach = (GRADIENT_REACH_PERCENT / 100) × planeRadius.
//   4. Accept with probability `localDensity`.
//
// Result: trees uniformly fill the visible plane at DENSITY_PERCENT
// coverage; the city interior is thinned to CITY_DENSITY_PERCENT of
// the outer density; the transition happens over the first
// GRADIENT_REACH_PERCENT of the plane around the city.
//
// Determinism is anchored to the bbox dims so the same laid-out city
// always produces the same parks across reloads.

import RBush from 'rbush';
import { PARKS } from '@/config/parks.js';
import { FOOTPRINT } from '@/config/footprint.js';
import { BUILDING_DIMENSIONS } from '@/config/building.js';
import { CAMERA_PERSPECTIVE } from '@/config/view.js';
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
}

/** Hard cap on the number of rejection-sample attempts. The actual
 *  number of placements depends on DENSITY_PERCENT × per-candidate
 *  acceptance. Bigger = denser fill is possible; cap perf scales
 *  linearly with this. */
const ABS_ATTEMPTS = 100000;

/** Multiplier on the city-corner-to-gem distance for the scatter
 *  circle's radius. 1.5× means the circle covers the entire city
 *  bbox plus a 50% halo of forest beyond the farthest building
 *  corner. The valley-floor mesh covers everything past this radius,
 *  so the discrete trees only need to fill the city + halo. */
const SCATTER_CITY_REACH_MULT = 1.5;

/** Fraction of the scatter radius over which density fades to 0 at
 *  the outer edge. Hides the perfectly-circular boundary of the
 *  scatter region. */
const EDGE_FALLOFF_FRAC = 0.15;

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

function pickKind(
  unit: number,
  treeFrac: number,
  bushFrac: number,
  flowerFrac: number,
): ParkPlacementKind {
  if (unit < treeFrac) return 'tree';
  if (unit < treeFrac + bushFrac) return 'bush';
  if (unit < treeFrac + bushFrac + flowerFrac) return 'flower-cluster';
  return 'tree';
}

/**
 * Compute the scatter center — the world-space point the tree
 * circle is built around. Uses the gem position (the closed end of
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
): ParkPlacement[] {
  const cfg = PARKS.get();
  if (!cfg.ENABLED) return [];

  const bbox = bboxOverride ?? layout.bbox;
  if (!bbox) return [];

  // FOOTPRINT.HALO_WIDTH inflates each layout rect outward so the
  // asphalt slab around the city silhouette also rejects trees. When
  // FOOTPRINT.ENABLED is false the halo is 0 (no inflation).
  const footprint = FOOTPRINT.get();
  const halo = footprint.ENABLED ? Math.max(0, footprint.HALO_WIDTH) : 0;

  const tree = new RBush<Rect>();
  const rects: Rect[] = [];
  const inflate = (r: Rect): Rect => ({
    minX: r.minX - halo, minY: r.minY - halo,
    maxX: r.maxX + halo, maxY: r.maxY + halo,
  });
  for (const b of layout.buildings) rects.push(inflate(bboxOfBuilding(b)));
  for (const s of layout.streets) rects.push(inflate(bboxOfStreet(s)));
  for (const p of layout.paths) rects.push(inflate(bboxOfPath(p)));
  if (rects.length > 0) tree.load(rects);
  const hasRects = rects.length > 0;

  const dims = BUILDING_DIMENSIONS.get();
  const halfFoot = (cfg.SCATTER_FOOTPRINT_FRAC_OF_MAX_WIDTH * dims.MAX_WIDTH) / 2;

  // Scatter region = circle centered at the GEM (root-of-repo
  // landmark) and sized to cover the full city + a halo. Trees past
  // this radius aren't needed — the valley-floor mesh paints the
  // visible ground all the way to camera FAR. The "plane reference"
  // for density gradients (CITY_DENSITY → full density transition)
  // is camera FAR so user percentages keep their meaning regardless
  // of how big or small this particular city is.
  const planeReference = CAMERA_PERSPECTIVE.get().FAR;
  const center = gemCenterFromLayout(layout, bbox);
  // Distance from the gem to the farthest bbox corner — guarantees
  // the scatter circle covers every part of the city bbox even when
  // the gem sits in a corner (root street at the bbox edge).
  const cornerDx = Math.max(
    Math.abs(center.x - bbox.minX),
    Math.abs(center.x - bbox.maxX),
  );
  const cornerDy = Math.max(
    Math.abs(center.y - bbox.minY),
    Math.abs(center.y - bbox.maxY),
  );
  const cityReach = Math.hypot(cornerDx, cornerDy);
  // Guard against degenerate bboxes (empty layout, no extent) so
  // tests with tiny placeholder bboxes still produce visible trees.
  const scatterRadius = Math.max(cityReach * SCATTER_CITY_REACH_MULT, 100);
  const edgeFalloffStart = scatterRadius * (1 - EDGE_FALLOFF_FRAC);

  // Density gating: convert percentages to fractions / world units.
  const density = Math.max(0, Math.min(1, cfg.DENSITY_PERCENT / 100));
  const cityDensity = Math.max(0, Math.min(1, cfg.CITY_DENSITY_PERCENT / 100));
  const gradientReach = Math.max(
    1, // avoid /0 when reach=0; gate becomes a sharp step at the city edge
    (cfg.GRADIENT_REACH_PERCENT / 100) * planeReference,
  );

  // Master seed from the bbox dims so the same layout always
  // produces the same parks across reloads.
  let masterSeed = mulberry32(Math.round(bbox.minX * 1000));
  masterSeed = mulberry32(masterSeed ^ Math.round(bbox.minY * 1000));
  masterSeed = mulberry32(masterSeed ^ Math.round(bbox.maxX * 1000));
  masterSeed = mulberry32(masterSeed ^ Math.round(bbox.maxY * 1000));

  const placements: ParkPlacement[] = [];
  if (density <= 0) return placements;

  // Scale attempt count by overall density so low density doesn't
  // waste CPU on rejected candidates.
  const attempts = Math.ceil(ABS_ATTEMPTS * density);

  for (let i = 0; i < attempts; i++) {
    const baseSeed = (masterSeed ^ (i + 1)) | 0;
    // Polar sample inside the visible-plane circle.
    // r = sqrt(uniform) × planeRadius gives uniform-in-area density.
    const rUnit = u32ToUnit(mulberry32(baseSeed ^ 0x12345678));
    const thetaUnit = u32ToUnit(mulberry32(baseSeed ^ 0x9abcdef0));
    const kUnit = u32ToUnit(mulberry32(baseSeed ^ 0xfedcba98));
    const accUnit = u32ToUnit(mulberry32(baseSeed ^ 0xa5a5a5a5));
    const r = Math.sqrt(rUnit) * scatterRadius;
    const theta = thetaUnit * 2 * Math.PI;
    const x = center.x + r * Math.cos(theta);
    const y = center.y + r * Math.sin(theta);

    // Overlap check.
    if (hasRects) {
      const hits = tree.search({
        minX: x - halfFoot, minY: y - halfFoot,
        maxX: x + halfFoot, maxY: y + halfFoot,
      });
      const overlaps = hits.some((h) =>
        h.minX < x + halfFoot && h.maxX > x - halfFoot &&
        h.minY < y + halfFoot && h.maxY > y - halfFoot,
      );
      if (overlaps) continue;
    }

    // Local density: gradient from cityDensity at d=0 to 1.0 at
    // d = gradientReach. Beyond gradientReach, full density.
    let localDensity: number;
    if (!hasRects) {
      // No buildings → flat full density (the city's not in the
      // scene yet; let the user see foliage anyway).
      localDensity = 1.0;
    } else {
      const d = distToNearestRect(x, y, tree, gradientReach);
      const t = Math.min(1, d / gradientReach);
      localDensity = cityDensity + (1.0 - cityDensity) * t;
    }

    // Edge falloff: density fades to 0 over the outer
    // EDGE_FALLOFF_FRAC of the scatter circle so the perfectly-
    // circular boundary doesn't read as a sharp tree-line in case
    // the user sees that far. Smoothstep from edgeFalloffStart →
    // scatterRadius.
    if (r > edgeFalloffStart) {
      const fadeT = (r - edgeFalloffStart) / (scatterRadius - edgeFalloffStart);
      const fade = 1 - fadeT * fadeT * (3 - 2 * fadeT); // smoothstep
      localDensity *= fade;
    }

    // Accept with probability localDensity. (The overall DENSITY
    // already scaled the attempt count above, so we don't multiply
    // by it here — that would double-discount.)
    if (accUnit > localDensity) continue;

    const kind = pickKind(kUnit, cfg.MIX_TREE_FRAC, cfg.MIX_BUSH_FRAC, cfg.MIX_FLOWER_FRAC);
    const counts = countsForKind(kind, cfg.FLOWERS_PER_BUSH, cfg.FLOWERS_PER_CLUSTER);
    placements.push({ x, y, seed: baseSeed, kind, ...counts });
  }

  return placements;
}
