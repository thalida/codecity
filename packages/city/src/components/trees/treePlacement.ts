// city/components/trees/treePlacement.ts — one tree per commit, scattered on a
// stratified grid: one jittered candidate per cell, run through the collision
// and density passes, sorted by distance from the gem so the oldest commit
// stands closest. A grid, so the work is bounded by cells, not by retries.

import RBush from 'rbush';
import * as THREE from 'three';
import { getWorldBounds } from '../../utils/floorBounds';
import { buildTopPolygon, pointInIslandPolygon } from '../island/islandGeometry';
import { islandSeedFromBounds } from '../island';
import { gemAnchorXZ } from '../gem/anchor';
import type { IslandConfig, WorldConfig } from '../../settings/fields/island';
import type { TreesConfig } from '../../settings/fields/trees';
import type { FootprintConfig } from '../../settings/fields/footprint';
import { Building } from '../../types/building';
import { CityBbox } from '../../types/scene';
import { Street, StreetAxis } from '../../types/street';

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
  /** Index into Manifest.commits: 0 is the oldest, and stands nearest the gem. */
  commitIndex: number;
}

/** All placeTrees reads. The worker gets this rather than the full layout, whose
 *  file payloads would make the structured clone expensive. */
export interface LayoutGeometry {
  buildings: Pick<Building, 'x' | 'y' | 'w' | 'd'>[];
  streets: Pick<Street, 'x' | 'y' | 'length' | 'width' | 'orientation' | 'isRoot'>[];
  bbox?: CityBbox;
}

/** The settings placeTrees reads, passed in rather than read from anywhere:
 *  this runs on the main thread and in the placement worker, and the two must
 *  scatter identically. ISLAND.ENABLED false skips the polygon rejection pass;
 *  its shape still sets the sampling extent. */
export interface TreePlacementConfig {
  TREES: TreesConfig;
  FOOTPRINT: FootprintConfig;
  WORLD: WorldConfig;
  ISLAND: IslandConfig;
}

export interface PlaceTreesOptions {
  /** Number of trees to plant — one per commit. */
  commitCount: number;
  /** Scene height, so a small but tall city gets a buffer to match. */
  cityHeight?: number;
  settings: TreePlacementConfig;
}

/** Ceiling on grid resolution, so a multi-million-commit repo can't OOM the
 *  renderer through the instance buffers downstream. */
const TREE_MAX_CELLS = 100_000;

/** Spare candidates for the rejection passes to eat, so the accepted count
 *  still reaches the target wherever there is room. */
const TREE_CELL_OVERSAMPLE = 4;

/** A floor for tiny repos: at the multiplier alone a 2-commit repo gets ~8
 *  cells, most of them inside the city. */
const TREE_MIN_CELLS = 256;

/** Mulberry32 — small PRNG with proper avalanche. */
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

/** The gem's position, through the same helper gem.ts uses so the two can't
 *  drift; the bbox centre for layouts with no root street. */
function gemCenterFromLayout(layout: LayoutGeometry, bbox: CityBbox): { x: number; y: number } {
  const root = layout.streets.find((s) => s.isRoot);
  if (!root) return { x: bbox.cx, y: bbox.cy };
  return gemAnchorXZ(root);
}

export function placeTrees(
  layout: LayoutGeometry,
  bboxOverride: CityBbox | undefined,
  options: PlaceTreesOptions
): TreePlacement[] {
  const cfg = options.settings.TREES;
  if (!cfg.ENABLED) return [];

  const bbox = bboxOverride ?? layout.bbox;
  if (!bbox) return [];

  const treeTarget = Math.max(0, options.commitCount | 0);
  if (treeTarget === 0) return [];

  const footprint = options.settings.FOOTPRINT;
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

  const bounds = getWorldBounds(bbox, options.settings.WORLD, options.cityHeight ?? 0);
  const center = gemCenterFromLayout(layout, bbox);

  // Sampled to the island polygon's extent, not the rect it circumscribes: the
  // ears past the rect corners would otherwise read as bare ground.
  const sides = options.settings.ISLAND.SIDES;
  // Jitter only shrinks vertices inward, so baseScale bounds the extent.
  const polygonScale = Math.SQRT2 / Math.cos(Math.PI / sides);
  const sampleHalfW = bounds.halfWidth * polygonScale;
  const sampleHalfD = bounds.halfDepth * polygonScale;

  // A share of the island, not a distance: a fixed gap that suits a big repo is
  // the whole of a small one. Off the narrow axis, and stacks with the halo.

  // Clamped in world units: the same share of a much bigger island is a
  // clearing wide enough to push the forest out of frame.
  const [clearanceMin, clearanceMax] = cfg.CITY_CLEARANCE_LIMITS;
  const halfFoot = THREE.MathUtils.clamp(
    Math.min(sampleHalfW, sampleHalfD) * (Math.max(0, cfg.CITY_CLEARANCE_PERCENT) / 100),
    Math.max(0, clearanceMin),
    Math.max(0, clearanceMax)
  );

  // The farthest a candidate can be from the city, which normalises the
  // falloff distance into [0,1].
  const falloffPower = cfg.DENSITY_FALLOFF;
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

  // The same polygon islandMesh renders, pulled inward by the inset so the
  // clearance from the edge reads as uniform however irregular it is.
  let islandPolygon: THREE.Vector3[] | null = null;
  const islandGeo = options.settings.ISLAND;
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
    // Every vertex pulled radially inward by insetFrac, clamped in world
    // units for the same reason the city clearance is.
    const insetFrac = cfg.EDGE_INSET_PERCENT / 100;
    const [insetMin, insetMax] = cfg.EDGE_INSET_LIMITS;
    islandPolygon = rawPolygon.map((v) => {
      const r = Math.hypot(v.x, v.z);
      if (r < 1e-6) return v.clone();
      const inset = THREE.MathUtils.clamp(
        r * insetFrac,
        Math.max(0, insetMin),
        Math.max(0, insetMax)
      );
      const scale = Math.max(0, r - inset) / r;
      return new THREE.Vector3(v.x * scale, v.y, v.z * scale);
    });
  }

  // Master seed from bbox dims for determinism.
  let masterSeed = mulberry32(Math.round(bbox.minX * 1000));
  masterSeed = mulberry32(masterSeed ^ Math.round(bbox.minY * 1000));
  masterSeed = mulberry32(masterSeed ^ Math.round(bbox.maxX * 1000));
  masterSeed = mulberry32(masterSeed ^ Math.round(bbox.maxY * 1000));

  // Enough cells to absorb the rejection passes, capped so a Linux-sized repo
  // can't blow up the worker. The aspect follows the sampling region.
  const samplingW = sampleHalfW * 2;
  const samplingD = sampleHalfD * 2;
  const desiredCells = Math.min(
    TREE_MAX_CELLS,
    Math.max(TREE_MIN_CELLS, Math.max(1, treeTarget) * TREE_CELL_OVERSAMPLE)
  );
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

  // One jittered candidate per cell. Falloff can thin a small island below the
  // commit count, so what it rejects is kept as spares to top up from.
  const accepted: { x: number; y: number; d2: number; seed: number }[] = [];
  const spares: { x: number; y: number; d2: number; seed: number }[] = [];
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

      // Acceptance falls off with distance from the city, so the forest thins
      // outward instead of ending at a line.
      let thinned = false;
      if (falloffActive) {
        const distX = Math.max(bbox.minX - x, 0, x - bbox.maxX);
        const distY = Math.max(bbox.minY - y, 0, y - bbox.maxY);
        const dist = Math.sqrt(distX * distX + distY * distY);
        const tnorm = Math.min(1, dist / maxFalloffDist);
        const acceptProb = Math.pow(1 - tnorm, falloffPower);
        const r = u32ToUnit(mulberry32(baseSeed ^ 0xfa110ff5));
        thinned = r > acceptProb;
      }

      // The polygon is in local coords and the candidate in world, so it
      // shifts back into the polygon's frame before the test.
      if (islandPolygon && !pointInIslandPolygon(x - bounds.cx, y - bounds.cz, islandPolygon))
        continue;

      const dx = x - center.x;
      const dy = y - center.y;
      (thinned ? spares : accepted).push({ x, y, d2: dx * dx + dy * dy, seed: baseSeed });
    }
  }

  if (accepted.length < treeTarget && spares.length > 0) {
    spares.sort((a, b) => a.d2 - b.d2);
    accepted.push(...spares.slice(0, treeTarget - accepted.length));
  }

  accepted.sort((a, b) => a.d2 - b.d2);

  // Spare candidates spread evenly across the sorted list; too few, and
  // commitIndex strides so the trees stand for the whole history.
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
