// layout.ts — Street/building placement algorithm. Pure data output, no DOM or Three.js.
//   Building: { x, y, w, d, h, color, file, orient }
//   Street:   { x, y, w, d, label, dir }
//
// All tunables come from the nanostores under src/config/. Tests that
// need different values mutate the stores via .setKey() in setup +
// restore in teardown — keeps the production callsites argument-free.
//
// The active packer lives in layoutV4.ts (Tier B global-occupancy packer).
// This file delegates layoutCity() to layoutCityV4 and retains the
// cross-cutting helpers used by both the V4 packer and runtime
// diagnostics (overlap checks, join-side marking, file stats, dimensions,
// rect helpers, etc.).

import { STREET_TIERS, BUILDING_DIMENSIONS } from '@/config/index.js';
import type { StreetTier } from '@/config/street.js';
import { BuildingOrient, JoinSide, NodeKind, StreetAxis } from '@/types';
import type { Building, BuildingPath, CityLayout, RangeStat, Street } from '@/types';
import { parentDirPath } from './path.js';
import { layoutCityV4 } from './layoutV4';
import { isMediaFile, getBillboardHeightFrac } from './billboards.js';

// Structural shapes — kept lenient so test fixtures (which omit fields the
// helpers don't read, like name/path on intermediate nodes) stay
// compatible. Real callers pass full Manifest / TreeNode / FileNode
// instances which structurally satisfy these.
export interface FileLike {
  type?: string;
  name?: string;
  extension?: string;
  lines?: number;
  size?: number;
  [k: string]: unknown;
}
export interface DirLike {
  type?: string;
  name?: string;
  path?: string;
  children?: TreeLike[];
  descendants_count?: number;
  children_count?: number;
  [k: string]: unknown;
}
export type TreeLike = FileLike | DirLike;

// Rect — axis-aligned bounding rectangle in some 2D frame. Used by overlap
// invariant checks and the V4 packer. (x, y) is the rect's CENTER; w/d
// are the full width/depth (matches Building/Street conventions).
export interface Rect {
  x: number;
  y: number;
  w: number;
  d: number;
}

// _rectsOverlap(a, b) -> boolean
//
// True iff two axis-aligned rectangles intersect by more than FP noise.
// Touching edges (zero overlap) returns false; the packer relies on this
// so that two rects abutted at exactly childGap apart count as
// non-overlapping. Because layout edges are derived from CENTER ± SIZE/2
// after additive translation through non-integer offsets (e.g. a path's
// far edge `61.6 + 2 = 63.6` vs a building's near edge `66.6 - 3 =
// 63.5999…`), strict `<` comparison on FP-derived edges sporadically
// reports the touching case as a sub-femto-unit overlap.
//
// OVERLAP_EPS: tolerance for IEEE-754 noise that arises when two touching
// rects have edges computed via different additive paths (e.g. center+size/2
// vs neighbor-center-size/2 through a non-integer subAnchor). Empirically
// ~7e-15 per single translation; a few orders of magnitude higher under
// deep recursion at large coordinate scales. 1e-9 sits well above this
// noise band and far below any visible-scale geometry (smallest gap ~1
// unit), so it eliminates false-positive overlaps without masking real ones.
const OVERLAP_EPS = 1e-9;
function _rectsOverlap(a: Rect, b: Rect): boolean {
  const ax1 = a.x - a.w / 2,
    ax2 = a.x + a.w / 2;
  const ay1 = a.y - a.d / 2,
    ay2 = a.y + a.d / 2;
  const bx1 = b.x - b.w / 2,
    bx2 = b.x + b.w / 2;
  const by1 = b.y - b.d / 2,
    by2 = b.y + b.d / 2;
  return (
    ax1 < bx2 - OVERLAP_EPS &&
    ax2 > bx1 + OVERLAP_EPS &&
    ay1 < by2 - OVERLAP_EPS &&
    ay2 > by1 + OVERLAP_EPS
  );
}

// _bboxOfRects(rects) -> Rect
//
// Axis-aligned bounding box of an array of rects. (x, y) is the bbox
// CENTER; w/d are the full width/depth — matches the Rect convention used
// elsewhere. Empty input returns a zero-size rect at the origin so the
// caller doesn't have to special-case it.
function _bboxOfRects(rects: Rect[]): Rect {
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    const x1 = r.x - r.w / 2,
      x2 = r.x + r.w / 2;
    const y1 = r.y - r.d / 2,
      y2 = r.y + r.d / 2;
    if (x1 < minX) minX = x1;
    if (x2 > maxX) maxX = x2;
    if (y1 < minY) minY = y1;
    if (y2 > maxY) maxY = y2;
  }
  if (minX === Infinity) return { x: 0, y: 0, w: 0, d: 0 };
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, w: maxX - minX, d: maxY - minY };
}


// _collectRects(layout) -> Rect[]
//
// Flatten a partial layout (streets + buildings + paths) into a single
// rect list for occupancy testing. A Street with orientation X has its
// long side on x and its short side on y; orientation Y is the inverse.
// Buildings and paths already use { x, y, w, d } directly.
function _collectRects(layout: {
  streets?: Street[];
  buildings?: Building[];
  paths?: BuildingPath[];
}): Rect[] {
  const out: Rect[] = [];
  if (layout.streets) {
    for (let i = 0; i < layout.streets.length; i++) {
      const s = layout.streets[i];
      if (s.orientation === StreetAxis.X) {
        out.push({ x: s.x, y: s.y, w: s.length, d: s.width });
      } else {
        out.push({ x: s.x, y: s.y, w: s.width, d: s.length });
      }
    }
  }
  if (layout.buildings) {
    for (let i = 0; i < layout.buildings.length; i++) {
      const b = layout.buildings[i];
      out.push({ x: b.x, y: b.y, w: b.w, d: b.d });
    }
  }
  if (layout.paths) {
    for (let i = 0; i < layout.paths.length; i++) {
      const p = layout.paths[i];
      out.push({ x: p.x, y: p.y, w: p.w, d: p.d });
    }
  }
  return out;
}

interface ManifestLike {
  tree?: DirLike;
  [k: string]: unknown;
}

// getStreetWidth(count, tiers?) -> number
//
// Given a descendant count and (optionally) a tier list, return the
// world-unit street width. The tier list defaults to STREET_TIERS.get().
// Each tier entry is { min_descendants, width }. Walk the list and pick
// the tier with the highest min_descendants that `count` meets. The last
// tier (largest min_descendants) acts as the catch-all for big directories.
export function getStreetWidth(count: number, tiers?: StreetTier[]): number {
  const arr = tiers && tiers.length ? tiers : STREET_TIERS.get();
  let chosen = arr[0].width;
  for (let i = 0; i < arr.length; i++) {
    if (count >= arr[i].min_descendants) chosen = arr[i].width;
  }
  return chosen;
}

// computeFileStats(tree) -> { lines: { min, max }, bytes: { min, max } }
//
// Walks the manifest once and returns the project's own range for both
// non-zero line counts and non-zero file sizes. Both are needed up front so
// every building can be normalized into the project's actual range (smallest
// → MIN_*, largest → MAX_*) instead of against an absolute global anchor.
// Empty / degenerate trees return { min: 1, max: 1 } so the renderer never
// divides by zero.
export function computeFileStats(tree: TreeLike): { lines: RangeStat; bytes: RangeStat } {
  let minLines = Infinity,
    maxLines = -Infinity;
  let minBytes = Infinity,
    maxBytes = -Infinity;
  function walk(node: TreeLike | null | undefined): void {
    if (!node) return;
    if (node.type === NodeKind.File) {
      const f = node as FileLike;
      if (f.lines && f.lines > 0) {
        if (f.lines < minLines) minLines = f.lines;
        if (f.lines > maxLines) maxLines = f.lines;
      }
      if (f.size && f.size > 0) {
        if (f.size < minBytes) minBytes = f.size;
        if (f.size > maxBytes) maxBytes = f.size;
      }
    }
    const children = (node as DirLike).children;
    if (children) {
      for (let i = 0; i < children.length; i++) walk(children[i]);
    }
  }
  walk(tree);
  return {
    lines: minLines === Infinity ? { min: 1, max: 1 } : { min: minLines, max: maxLines },
    bytes: minBytes === Infinity ? { min: 1, max: 1 } : { min: minBytes, max: maxBytes },
  };
}

// computeLineStats(tree) — kept for back-compat with tests that only need
// the line-count range. New callers should use computeFileStats.
export function computeLineStats(tree: TreeLike): RangeStat {
  return computeFileStats(tree).lines;
}

// getBuildingDimensions(file, lineStats?, byteStats?) -> { w, d, h, floors }
//
// Floors and width are BOTH project-relative: the smallest file lands at
// MIN_*, the largest at MAX_*, everything else interpolated. Floors uses
// sqrt to spread the bottom of the range while compressing the long tail;
// width uses log (file sizes span many orders of magnitude). Without a
// stats object, the corresponding dimension falls back to MIN_*.
export function getBuildingDimensions(
  file: FileLike,
  lineStats?: RangeStat,
  byteStats?: RangeStat
): { w: number; d: number; h: number; floors: number } {
  const dims = BUILDING_DIMENSIONS.get();
  const maxFloorsCap = dims.MAX_FLOORS != null ? dims.MAX_FLOORS : 30;

  // ---- Floors from line count (sqrt-normalized over project range) ----
  const lines = file.lines && file.lines > 0 ? file.lines : 1;
  let floors = dims.MIN_FLOORS;
  if (lineStats && lineStats.max > lineStats.min) {
    const sMin = Math.sqrt(lineStats.min);
    const sMax = Math.sqrt(lineStats.max);
    const sLines = Math.sqrt(lines);
    let tH = (sLines - sMin) / (sMax - sMin);
    if (tH < 0) tH = 0;
    else if (tH > 1) tH = 1;
    floors = Math.round(dims.MIN_FLOORS + tH * (maxFloorsCap - dims.MIN_FLOORS));
    if (floors < dims.MIN_FLOORS) floors = dims.MIN_FLOORS;
  }
  const height = floors * dims.FLOOR_HEIGHT;

  // ---- Width from byte size (log-normalized over project range) ----
  const bytes = file.size && file.size > 0 ? file.size : 1;
  let width = dims.MIN_WIDTH;
  if (byteStats && byteStats.max > byteStats.min) {
    const lMin = Math.log(byteStats.min);
    const lMax = Math.log(byteStats.max);
    const lBytes = Math.log(bytes);
    let tW = (lBytes - lMin) / (lMax - lMin);
    if (tW < 0) tW = 0;
    else if (tW > 1) tW = 1;
    width = dims.MIN_WIDTH + tW * (dims.MAX_WIDTH - dims.MIN_WIDTH);
  }

  // Media files render as billboards instead of building cuboids — the
  // sign's visual extent isn't the byte-derived `height` above (which
  // for binary files is just MIN_FLOORS × FLOOR_HEIGHT, basically a
  // flat slab on the ground). Override `h` to the billboard's actual
  // height so the selection outline, camera focus framing, and bbox
  // wrap the whole sign instead of clinging to the lot.
  let h = height;
  if (isMediaFile(file)) {
    h = width * getBillboardHeightFrac();
  }

  // Depth == width keeps footprints square so tall thin towers don't
  // become deep slabs.
  return {
    w: Math.round(width * 10) / 10,
    d: Math.round(width * 10) / 10,
    h: Math.round(h * 10) / 10,
    floors,
  };
}

// -----------------------------------------------------------------------------
// layoutCity(manifest) -> { streets, buildings, paths }
//
// Top-level layout function. Walks the directory tree and produces a STREET
// NETWORK in world coordinates: each directory becomes a street, files line
// the street's "near" side as buildings, and subdirectories branch off the
// "far" side as perpendicular streets (recursively).
//
// Return shape:
//   streets:   [{ x, y, length, width, orientation, label, dir }]
//   buildings: [{ x, y, w, d, h, color, file, orient, hitBox: { x, y, w, h } }]
//   paths:     [{ x, y, w, d }]
//
// `color` starts as null — the renderer must call getBuildingColor before drawing.
// Delegates to layoutCityV4 (Tier B global-occupancy packer).
// -----------------------------------------------------------------------------
export function layoutCity(manifest: ManifestLike | DirLike): CityLayout {
  return layoutCityV4(manifest);
}

// -----------------------------------------------------------------------------
// _streetWidthForDir(dir) -> number
//
// Maps a directory's descendants to a tier and returns the visual width of
// its street. Larger directories get wider boulevards.
// -----------------------------------------------------------------------------
export function _streetWidthForDir(dir: DirLike | null | undefined): number {
  const count = (dir && (dir.descendants_count || dir.children_count)) || 0;
  return getStreetWidth(count, STREET_TIERS.get());
}

// -----------------------------------------------------------------------------
// _markJoinSides(streets) — for every non-root street, stash whether its
// JOINING endpoint is the LOW or HIGH end of its orientation axis. The
// renderer uses this to flatten the joining end (so it merges cleanly
// into the parent T-intersection) while keeping the open end rounded.
//
// We figure it out by comparing each endpoint's distance to the parent
// street's centerline — the closer one is touching the parent. That's
// simpler than trying to track mirror-flag transformations through the
// recursive layout, and works regardless of negate flags.
// -----------------------------------------------------------------------------
// Streets in this internal helper carry a transient `joinSide` flag stamped
// after layout. The Street type doesn't model that field (it's only used
// inside engine.js for cap-style selection), so we widen here.
type StreetWithJoin = Street & { joinSide?: JoinSide };

export function _markJoinSides(streets: StreetWithJoin[]): void {
  const byPath: Record<string, StreetWithJoin> = {};
  for (let i = 0; i < streets.length; i++) {
    const s = streets[i];
    if (s.dir && s.dir.path != null) byPath[s.dir.path] = s;
  }

  for (let j = 0; j < streets.length; j++) {
    const s2 = streets[j];
    if (s2.isRoot) continue;
    if (!s2.dir || s2.dir.path == null) continue;
    const pPath = parentDirPath(s2.dir.path);
    if (pPath == null) continue;
    const parent = byPath[pPath];
    if (!parent) continue;

    // Child's two endpoints along its length axis (in world coords).
    let lowEnd, highEnd;
    if (s2.orientation === StreetAxis.X) {
      lowEnd = s2.x - s2.length / 2;
      highEnd = s2.x + s2.length / 2;
    } else {
      lowEnd = s2.y - s2.length / 2;
      highEnd = s2.y + s2.length / 2;
    }

    // For a parent + child meeting at a T-intersection, the parent runs
    // perpendicular to the child. The child's joining endpoint sits ON the
    // parent's CENTERLINE, which is a constant value of the parent's
    // CROSS-AXIS (parent.y for x-orient parent, parent.x for y-orient
    // parent). For perpendicular orientations, the parent's cross-axis is
    // the child's LENGTH axis — so we compare each child endpoint along
    // its length axis to the parent's centerline value.
    const parentCrossAxis = parent.orientation === StreetAxis.X ? parent.y : parent.x;
    const dLow = Math.abs(lowEnd - parentCrossAxis);
    const dHigh = Math.abs(highEnd - parentCrossAxis);
    s2.joinSide = dLow < dHigh ? JoinSide.Low : JoinSide.High;
  }
}

// -----------------------------------------------------------------------------
// _mirrorOrient(orient, negateX, negateY) -> orient
//
// When a subtree's positions are mirrored by the parent's negateX / negateY
// flags, each building's door-facing orient has to flip to match. Otherwise
// the building ends up on the opposite side of its own street with its door
// pointing away.
// -----------------------------------------------------------------------------
export function _mirrorOrient(orient: BuildingOrient, negateX: boolean, negateY: boolean): BuildingOrient {
  if (negateX) {
    if (orient === BuildingOrient.East) orient = BuildingOrient.West;
    else if (orient === BuildingOrient.West) orient = BuildingOrient.East;
  }
  if (negateY) {
    if (orient === BuildingOrient.South) orient = BuildingOrient.North;
    else if (orient === BuildingOrient.North) orient = BuildingOrient.South;
  }
  return orient;
}

// -----------------------------------------------------------------------------
// sortForRendering(buildings) -> buildings[]
//
// Painter's algorithm: sorts buildings so that those further from the viewer
// (higher x + y sum) are drawn first. Returns a new sorted array.
// -----------------------------------------------------------------------------
export function sortForRendering<T extends { x: number; y: number }>(buildings: T[]): T[] {
  const sorted = buildings.slice();
  sorted.sort((a, b) => {
    // Ascending: lowest x+y drawn first.
    // In our projection sx=(x-y)*cos30, sy=(x+y)*sin30-z:
    //   Lower x+y = higher on screen (north-west) = behind
    //   Higher x+y = lower on screen (south-east) = in front
    // Painter's: draw behind first (low x+y), in-front last (high x+y).
    return a.x + a.y - (b.x + b.y);
  });
  return sorted;
}

// -----------------------------------------------------------------------------
// findLayoutOverlaps(layout) -> LayoutOverlap[]
//
// Runtime overlap diagnostic. Walks every (street, building, path) pair,
// reports any rect-rect intersection, and classifies it. Intended to be
// called from cityScene after layoutCity for live debugging — the test
// suite (assertNoOverlap) covers synthetic trees but visual bugs surface
// only against real manifests, where this helper helps locate them.
//
// Whitelist:
//   - 't-junction': two perpendicular streets joined at a T (one street's
//     length-axis endpoint sits on the other's centerline within both half-
//     widths). This is the documented flat join the renderer fuses.
// Anything else is 'unexpected'.
//
// `_isStreetJoinPair` mirrors the geometry test in tests/scene/layout.test.ts
// (kept independent so the runtime helper has no test-file dependency).
function _isStreetJoinPair(a: Street, b: Street): boolean {
  if (a.orientation === b.orientation) return false;
  const aLong = a.orientation === StreetAxis.X ? 'x' : 'y';
  const aCross = a.orientation === StreetAxis.X ? 'y' : 'x';
  const bLong = b.orientation === StreetAxis.X ? 'x' : 'y';
  const half = a.length / 2;
  const lowEnd = a[aLong] - half;
  const highEnd = a[aLong] + half;
  const bCenterAlongA = b[aLong];
  const dLow = Math.abs(lowEnd - bCenterAlongA);
  const dHigh = Math.abs(highEnd - bCenterAlongA);
  const aPerpAtJoin = a[aCross];
  const bCenterPerp = b[bLong];
  const perpClose = Math.abs(aPerpAtJoin - bCenterPerp) <= b.length / 2 + 0.5;
  const longClose = Math.min(dLow, dHigh) <= b.width / 2 + 0.5;
  return perpClose && longClose;
}

export type LayoutOverlapKind = 'street' | 'building' | 'path';
export type LayoutOverlapCategory = 't-junction' | 'unexpected';

export interface LayoutOverlap {
  kindA: LayoutOverlapKind;
  kindB: LayoutOverlapKind;
  labelA: string;
  labelB: string;
  rectA: Rect;
  rectB: Rect;
  /** Intersection box. (x, y) is the intersection center; w/d are overlap dims. */
  overlap: Rect;
  category: LayoutOverlapCategory;
}

function _intersectRect(a: Rect, b: Rect): Rect {
  const ax1 = a.x - a.w / 2,
    ax2 = a.x + a.w / 2;
  const ay1 = a.y - a.d / 2,
    ay2 = a.y + a.d / 2;
  const bx1 = b.x - b.w / 2,
    bx2 = b.x + b.w / 2;
  const by1 = b.y - b.d / 2,
    by2 = b.y + b.d / 2;
  const ox1 = Math.max(ax1, bx1);
  const ox2 = Math.min(ax2, bx2);
  const oy1 = Math.max(ay1, by1);
  const oy2 = Math.min(ay2, by2);
  return { x: (ox1 + ox2) / 2, y: (oy1 + oy2) / 2, w: ox2 - ox1, d: oy2 - oy1 };
}

export function findLayoutOverlaps(layout: {
  streets: Street[];
  buildings: Building[];
  paths: BuildingPath[];
}): LayoutOverlap[] {
  type Tagged =
    | { kind: 'street'; rect: Rect; label: string; ref: Street }
    | { kind: 'building'; rect: Rect; label: string; ref: Building }
    | { kind: 'path'; rect: Rect; label: string; ref: BuildingPath };
  const all: Tagged[] = [];
  for (const s of layout.streets) {
    const rect: Rect =
      s.orientation === StreetAxis.X
        ? { x: s.x, y: s.y, w: s.length, d: s.width }
        : { x: s.x, y: s.y, w: s.width, d: s.length };
    all.push({ kind: 'street', rect, label: s.dir?.path ?? s.label ?? '(root)', ref: s });
  }
  for (const b of layout.buildings) {
    all.push({
      kind: 'building',
      rect: { x: b.x, y: b.y, w: b.w, d: b.d },
      label: b.file?.path ?? b.file?.name ?? '?',
      ref: b,
    });
  }
  for (const p of layout.paths) {
    all.push({
      kind: 'path',
      rect: { x: p.x, y: p.y, w: p.w, d: p.d },
      label: p.file?.path ?? p.file?.name ?? '?',
      ref: p,
    });
  }

  const out: LayoutOverlap[] = [];
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const A = all[i],
        B = all[j];
      if (!_rectsOverlap(A.rect, B.rect)) continue;
      const overlap = _intersectRect(A.rect, B.rect);
      // Skip FP-noise overlaps. The internal _rectsOverlap uses
      // OVERLAP_EPS=1e-9, which is below the IEEE-754 drift produced by
      // chains of Float32 translations at large coordinate magnitudes
      // (~1e-5 at coords of 10000+). Touching-edge cases produce overlaps
      // with one dimension in that drift range; they're visually
      // imperceptible and not actual layout bugs.
      if (overlap.w < 1e-3 || overlap.d < 1e-3) continue;
      let category: LayoutOverlapCategory = 'unexpected';
      if (A.kind === 'street' && B.kind === 'street' && _isStreetJoinPair(A.ref, B.ref)) {
        category = 't-junction';
      }
      out.push({
        kindA: A.kind,
        kindB: B.kind,
        labelA: A.label,
        labelB: B.label,
        rectA: A.rect,
        rectB: B.rect,
        overlap,
        category,
      });
    }
  }
  return out;
}

// Internal helpers exposed for tests only. Not part of the public API.
export const __test = {
  _rectsOverlap,
  _bboxOfRects,
  _collectRects,
};
