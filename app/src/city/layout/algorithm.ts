// city/layout/algorithm.ts — Street/building placement algorithm. Pure data output,
// no DOM or Three.js.
//   Building: { x, y, w, d, h, color, file, orient }
//   Street:   { x, y, w, d, label, dir }
//
// All tunables come from the nanostores under src/config/. Tests that
// need different values mutate the stores via .setKey() in setup +
// restore in teardown — keeps the production callsites argument-free.
//
// Layout works via a global-occupancy packer: each directory becomes a
// street, files line the street as buildings, and subdirectories branch
// off as perpendicular streets. The packer (placeChild /
// findSmallestValidStem / _layoutDir) decides each placement by
// querying a WorldOccupancy structure for the smallest stem offset that
// keeps the new geometry from intersecting anything already placed.

import { STREET_TIERS, STREET_LAYOUT } from '@/state/stores/settings/streets';
import { BUILDING_DIMENSIONS } from '@/state/stores/settings/buildings';
import { GEM_SIZING } from '@/state/stores/settings/gem';
import type { StreetTier } from '@/state/stores/settings/streets';
import { BuildingOrient, JoinSide, NodeKind, StreetAxis } from '@/types';
import type { Building, CityLayout, RangeStat, Street } from '@/types';
import { parentDirPath } from '../utils/path';
import { rectOfBuilding, rectOfStreet } from './rect';
import type { Rect } from './rect';
import { isMediaFile } from '../utils/mediaKind';
import { WorldOccupancy, WorldRectKind } from './occupancyIndex';
import type { WorldRect } from './occupancyIndex';

// Dead-space pad past the gem at the root street's origin end, as a multiple of
// the gem's diameter. Fixed, not user-tunable (was in GEM_SIZING but never
// exposed as a control).
const GEM_CLEARANCE_AS_GEM_WIDTH_FRAC = 1.0;

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

// _rectsOverlap(a, b) -> boolean
//
// True iff two axis-aligned rectangles intersect by more than FP noise.
// Touching edges (zero overlap) returns false; the packer relies on this
// so that two rects abutted at exactly their sibling gap apart count as
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
// Flatten a partial layout (streets + buildings) into a single rect list
// for occupancy testing.
function _collectRects(layout: { streets?: Street[]; buildings?: Building[] }): Rect[] {
  const out: Rect[] = [];
  if (layout.streets) {
    for (let i = 0; i < layout.streets.length; i++) {
      out.push(rectOfStreet(layout.streets[i]));
    }
  }
  if (layout.buildings) {
    for (let i = 0; i < layout.buildings.length; i++) {
      out.push(rectOfBuilding(layout.buildings[i]));
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
  const arr = tiers && tiers.length ? tiers : STREET_TIERS.value.TIERS;
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
  file: {
    lines?: number | null;
    size?: number | null;
    extension?: string;
    mediaKind?: 'image' | 'video' | null;
    media_width?: number;
    media_height?: number;
  },
  lineStats?: RangeStat,
  byteStats?: RangeStat
): { w: number; d: number; h: number; floors: number } {
  const dims = BUILDING_DIMENSIONS.value;
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

  // Media files (image/video) override the lines-driven height: the
  // building's silhouette mirrors the image's natural aspect ratio
  // instead. Width still comes from bytes; height snaps to a whole-
  // floor count so the facade shader's window tiling stays consistent
  // with regular buildings. Missing dims → 1:1 aspect (square fallback).
  let h = height;
  let mediaFloors = floors;
  if (isMediaFile(file)) {
    const mw = file.media_width;
    const mh = file.media_height;
    const rawAspect = mw && mh && mw > 0 ? mh / mw : 1.0;
    const aspect = Math.min(2.5, Math.max(0.4, rawAspect));
    const rawHeight = width * aspect;
    mediaFloors = Math.max(dims.MIN_FLOORS, Math.round(rawHeight / dims.FLOOR_HEIGHT));
    h = mediaFloors * dims.FLOOR_HEIGHT;
  }

  // Depth == width keeps footprints square so tall thin towers don't
  // become deep slabs.
  return {
    w: Math.round(width * 10) / 10,
    d: Math.round(width * 10) / 10,
    h: Math.round(h * 10) / 10,
    floors: mediaFloors,
  };
}

// HeightContext — project-wide stats needed to reproduce getBuildingDimensions
// for a single file without re-running the full layout. Derive it once from
// the new manifest's tree via makeHeightContext(), then pass to
// recomputeBuildingDimensions() for each building in Phase 2.
export interface HeightContext {
  lineStats: RangeStat;
  byteStats: RangeStat;
}

// makeHeightContext(tree) → HeightContext
//
// Walks the manifest tree once and returns the project-wide line + byte ranges
// needed by recomputeBuildingDimensions. Thin wrapper over computeFileStats
// with a named return type so call sites are self-documenting.
export function makeHeightContext(tree: TreeLike): HeightContext {
  const stats = computeFileStats(tree);
  return { lineStats: stats.lines, byteStats: stats.bytes };
}

// recomputeBuildingDimensions(file, ctx) → { w, d, h, floors }
//
// Re-derives a single building's dimensions (height, footprint, floor count)
// from its FileNode and the project-wide HeightContext. Delegates to
// getBuildingDimensions with the context stats unpacked.
//
// Use this in Phase 2 of applyManifest so that the cached layout (which holds
// skeleton-era placeholder dimensions) is updated to reflect the final
// manifest's real per-file sizes and line counts.
export function recomputeBuildingDimensions(
  file: FileLike,
  ctx: HeightContext
): { w: number; d: number; h: number; floors: number } {
  return getBuildingDimensions(file, ctx.lineStats, ctx.byteStats);
}

// ─── Stem-placement diagnostic types ────────────────────────────────────────
// Used by the "Diagnose stem placement" debug button. None of these types
// affect normal layout — they're only populated when an optional `trace`
// param is supplied to findSmallestValidStem / placeChild / _layoutDir.

export interface ForbiddenIntervalRecord {
  lower: number;
  upper: number;
  obstacle: WorldRect;
  fromChildRectIndex: number;
}

export interface VariantTrace {
  /** Set by the caller (placeChild) before passing to findSmallestValidStem. */
  side: 0 | 1;
  /** Set by the caller (placeChild) before passing to findSmallestValidStem. */
  mirror: boolean;
  /** Filled by findSmallestValidStem. */
  stem: number;
  /** Filled by findSmallestValidStem. */
  forbidden: ForbiddenIntervalRecord[];
  /** Filled by findSmallestValidStem. Index into `forbidden` of the interval
   *  whose `.upper` set the final stem, or null if the chosen stem ==
   *  baseline (no jump). */
  bindingIndex: number | null;
}

export interface PlaceChildTrace {
  variants: VariantTrace[];
}

export interface ChildPlacementTrace {
  childKind: 'file' | 'dir';
  childLabel: string;
  childPath: string;
  parentPath: string;
  baseline: number;
  priorStem: number;
  originPad: number;
  chosen: VariantTrace;
  others: VariantTrace[];
}

export interface StemPlacementTrace {
  placements: ChildPlacementTrace[];
}

// computeFlips(parentOrient, side, mirror) → {flipX, flipY}
//
// For X-orient parent: side flips perp (Y), mirror flips along (X) of the child.
// For Y-orient parent: side flips perp (X), mirror flips along (Y) of the child.
export function computeFlips(
  parentOrient: StreetAxis,
  side: 0 | 1,
  mirror: boolean
): { flipX: boolean; flipY: boolean } {
  if (parentOrient === StreetAxis.X) {
    return { flipX: mirror, flipY: side === 0 };
  }
  return { flipX: side === 0, flipY: mirror };
}

// applyFlips(rect, flipX, flipY) → flipped Rect
//
// Negates the rect's center coordinates per the flip flags. Width and depth
// are unchanged (rects are AABBs, not oriented).
export function applyFlips(rect: Rect, flipX: boolean, flipY: boolean): Rect {
  return {
    x: flipX ? -rect.x : rect.x,
    y: flipY ? -rect.y : rect.y,
    w: rect.w,
    d: rect.d,
  };
}

// isMirrorInvariant(rects, parentOrient) → boolean
//
// True iff mirroring across the perp axis (the axis flipped by `mirror=true`)
// produces the same rect list (within OVERLAP_EPS). Used to skip mirror=true
// variants when they'd be no-ops.
//
// For X-orient parent: mirror flips X. Invariant iff for every rect there's a
// matching rect with -x and same y, w, d.
// For Y-orient parent: mirror flips Y. Symmetric.
export function isMirrorInvariant(rects: Rect[], parentOrient: StreetAxis): boolean {
  // Empty list is trivially invariant.
  if (rects.length === 0) return true;
  // For each rect r in rects, the mirrored r must also exist in rects.
  // O(n²) but n is small per subtree; acceptable.
  for (const r of rects) {
    let found = false;
    for (const s of rects) {
      const mirrorX = parentOrient === StreetAxis.X ? -r.x : r.x;
      const mirrorY = parentOrient === StreetAxis.Y ? -r.y : r.y;
      if (
        Math.abs(s.x - mirrorX) <= OVERLAP_EPS &&
        Math.abs(s.y - mirrorY) <= OVERLAP_EPS &&
        Math.abs(s.w - r.w) <= OVERLAP_EPS &&
        Math.abs(s.d - r.d) <= OVERLAP_EPS
      ) {
        found = true;
        break;
      }
    }
    if (!found) return false;
  }
  return true;
}

interface FindSmallestValidStemParams {
  childRects: Rect[]; // rects in CHILD-LOCAL frame
  parentOrient: StreetAxis;
  side: 0 | 1;
  mirror: boolean;
  parentOriginX: number; // parent's main-street origin in world
  parentOriginY: number;
  priorStem: number; // alphabetical-monotonic: stem ≥ priorStem
  originPad: number; // stem ≥ originPad (parent's join clearance)
  // Sibling clearance is split by kind: a building reserves buildingGap, a
  // side street reserves streetGap. The clearance between the placing child and
  // any obstacle is max(gap for childKind, gap for the obstacle's kind), so a
  // pair touching a side street gets the (typically larger) street gap on both
  // sides while building↔building stays at buildingGap.
  buildingGap: number;
  streetGap: number;
  childKind: WorldRectKind; // kind of the child being placed
  occupancy: WorldOccupancy; // global occupancy structure
}

// findSmallestValidStem — for one (side, mirror) variant, compute the
// smallest stem ≥ max(priorStem, originPad) such that translating every
// child rect by (side, mirror, stem, parentOrigin) doesn't overlap any
// rect in occupancy. Uses the forbidden-interval union algorithm for
// gap-fit packing.
//
// Optional `trace` param: when provided, the function fills in
// trace.forbidden with the obstacle + child-rect provenance of every
// forbidden interval, trace.bindingIndex with the index of the interval that
// set the final stem (or null if the chosen stem equals the baseline), and
// trace.stem with the returned value. The trace param has no effect on the
// algorithm or return value; it is purely an out-parameter.
export function findSmallestValidStem(
  p: FindSmallestValidStemParams,
  trace?: VariantTrace
): number {
  const { flipX, flipY } = computeFlips(p.parentOrient, p.side, p.mirror);
  // Gap the placing child reserves around itself (by its kind).
  const placingGap = p.childKind === WorldRectKind.Street ? p.streetGap : p.buildingGap;

  // Collect forbidden stem intervals from all (childRect, candidate) pairs.
  const forbidden: ForbiddenIntervalRecord[] = [];

  for (let rIdx = 0; rIdx < p.childRects.length; rIdx++) {
    const r = p.childRects[rIdx];
    const flipped = applyFlips(r, flipX, flipY);

    let alongMin0: number, alongMax0: number, perpMin: number, perpMax: number;
    if (p.parentOrient === StreetAxis.X) {
      alongMin0 = flipped.x - flipped.w / 2 + p.parentOriginX;
      alongMax0 = flipped.x + flipped.w / 2 + p.parentOriginX;
      perpMin = flipped.y - flipped.d / 2 + p.parentOriginY;
      perpMax = flipped.y + flipped.d / 2 + p.parentOriginY;
    } else {
      perpMin = flipped.x - flipped.w / 2 + p.parentOriginX;
      perpMax = flipped.x + flipped.w / 2 + p.parentOriginX;
      alongMin0 = flipped.y - flipped.d / 2 + p.parentOriginY;
      alongMax0 = flipped.y + flipped.d / 2 + p.parentOriginY;
    }

    const candidates =
      p.parentOrient === StreetAxis.X
        ? p.occupancy.query(-Infinity, perpMin, Infinity, perpMax)
        : p.occupancy.query(perpMin, -Infinity, perpMax, Infinity);

    for (const g of candidates) {
      const gMinAlong = p.parentOrient === StreetAxis.X ? g.minX : g.minY;
      const gMaxAlong = p.parentOrient === StreetAxis.X ? g.maxX : g.maxY;

      // Separation to this obstacle. The parent-body phantom isn't a sibling —
      // the gap to it is just the building baseline (its branch-join spacing
      // comes from PARENT_JOIN_PAD via originPad, not the sibling gap). For real
      // siblings it's max-of-both-kinds, so a side street keeps its clearance on
      // both sides regardless of placement order.
      const obsGap = g.kind === WorldRectKind.Street ? p.streetGap : p.buildingGap;
      const sep = g.parentBody ? p.buildingGap : Math.max(placingGap, obsGap);
      const lower = gMinAlong - alongMax0 - sep;
      const upper = gMaxAlong - alongMin0 + sep;
      if (upper > lower) {
        forbidden.push({ lower, upper, obstacle: g, fromChildRectIndex: rIdx });
      }
    }
  }

  forbidden.sort((a, b) => a.lower - b.lower);
  let s = Math.max(p.priorStem, p.originPad);
  let bindingIndex: number | null = null;
  for (let i = 0; i < forbidden.length; i++) {
    const interval = forbidden[i];
    if (s < interval.lower) break;
    if (s < interval.upper) {
      s = interval.upper;
      bindingIndex = i;
    }
  }

  if (trace) {
    trace.forbidden = forbidden;
    trace.bindingIndex = bindingIndex;
    trace.stem = s;
  }
  return s;
}

interface PlaceChildParams {
  childRects: Rect[];
  parentOrient: StreetAxis;
  parentOriginX: number;
  parentOriginY: number;
  /** Single-value floor. If `priorStems` is also supplied, it takes
   *  precedence; this remains for tests and call sites that don't care about
   *  per-side tracking. */
  priorStem: number;
  /** Per-side floors. priorStems[0] applies when evaluating side-0 variants,
   *  priorStems[1] for side-1. When omitted, falls back to `priorStem` on
   *  both sides (the original cross-side alphabetical-monotonic behavior).
   *  When supplied, lets a child on side A fit at a lower stem than its
   *  alphabetical predecessor on side B — the alphabetical-monotonic
   *  invariant is then enforced PER SIDE rather than across both sides. */
  priorStems?: readonly [number, number];
  originPad: number;
  buildingGap: number;
  streetGap: number;
  childKind: WorldRectKind;
  occupancy: WorldOccupancy;
}

export interface PlaceChildResult {
  stem: number;
  side: 0 | 1;
  mirror: boolean;
}

// placeChild — evaluates 4 (side × mirror) variants and picks the one with
// smallest stem. If mirror is invariant (the rect list is unchanged by
// perp-axis flip), only 2 variants (mirror=false) are evaluated.
//
// Tiebreak chain (when stems tie within OVERLAP_EPS):
//   1. Smaller stem wins (strict).
//   2. If stems tie: side 0 over side 1.
//   3. If sides tie: natural over mirrored.
//   4. If both tie: smaller stem within eps (mostly redundant).
//
// Optional `trace` param: when provided, every variant evaluated (including
// the loser ones) pushes a VariantTrace into trace.variants. No effect on
// algorithm or return value.
export function placeChild(p: PlaceChildParams, trace?: PlaceChildTrace): PlaceChildResult {
  const mirrorInvariant = isMirrorInvariant(p.childRects, p.parentOrient);

  let bestStem = +Infinity;
  let bestSide: 0 | 1 = 0;
  let bestMirror = false;

  const tryVariant = (side: 0 | 1, mirror: boolean): void => {
    const variantTrace: VariantTrace | undefined = trace
      ? { side, mirror, stem: 0, forbidden: [], bindingIndex: null }
      : undefined;
    const sidePriorStem = p.priorStems ? p.priorStems[side] : p.priorStem;
    const stem = findSmallestValidStem(
      {
        childRects: p.childRects,
        parentOrient: p.parentOrient,
        side,
        mirror,
        parentOriginX: p.parentOriginX,
        parentOriginY: p.parentOriginY,
        priorStem: sidePriorStem,
        originPad: p.originPad,
        buildingGap: p.buildingGap,
        streetGap: p.streetGap,
        childKind: p.childKind,
        occupancy: p.occupancy,
      },
      variantTrace
    );
    if (trace && variantTrace) trace.variants.push(variantTrace);

    // Tiebreak chain.
    let better = false;
    if (stem < bestStem - OVERLAP_EPS) {
      better = true;
    } else if (Math.abs(stem - bestStem) <= OVERLAP_EPS) {
      if (side < bestSide) better = true;
      else if (side === bestSide) {
        if (!mirror && bestMirror) better = true;
      }
    }
    if (better) {
      bestStem = stem;
      bestSide = side;
      bestMirror = mirror;
    }
  };

  tryVariant(0, false);
  tryVariant(1, false);
  if (!mirrorInvariant) {
    tryVariant(0, true);
    tryVariant(1, true);
  }

  return { stem: bestStem, side: bestSide, mirror: bestMirror };
}

// Typed rect with kind+ref preserved through translation. The child's
// pre-compute returns rects in this shape so we can translate them to
// WorldRect for occupancy insert.
export interface TypedRect extends Rect {
  kind: WorldRectKind;
  ref: WorldRect['ref'];
}

// translateRectsToWorld — applies (side, mirror) flips + parent origin +
// stem offset to convert child-local rects to world-frame WorldRects.
//
// For an X-orient parent: stem shifts along X.
// For a Y-orient parent: stem shifts along Y.
export function translateRectsToWorld(
  childRects: Array<Rect | TypedRect>,
  parentOrient: StreetAxis,
  parentOriginX: number,
  parentOriginY: number,
  stem: number,
  side: 0 | 1,
  mirror: boolean
): WorldRect[] {
  const { flipX, flipY } = computeFlips(parentOrient, side, mirror);
  const out: WorldRect[] = [];
  for (const r of childRects) {
    const flipped = applyFlips(r, flipX, flipY);
    // Add parent origin and stem along the parent's along axis.
    const worldX = flipped.x + parentOriginX + (parentOrient === StreetAxis.X ? stem : 0);
    const worldY = flipped.y + parentOriginY + (parentOrient === StreetAxis.Y ? stem : 0);
    const typed = r as TypedRect;
    out.push({
      minX: worldX - flipped.w / 2,
      minY: worldY - flipped.d / 2,
      maxX: worldX + flipped.w / 2,
      maxY: worldY + flipped.d / 2,
      kind: typed.kind ?? WorldRectKind.Building,
      ref: typed.ref ?? ({} as never),
    });
  }
  return out;
}

// SubtreeResult — what each _layoutDir call accumulates in its local frame.
// Streets and buildings use the existing CityLayout shape (kind+ref payload
// preserved). alongReach is the join-strip half-width the parent street
// physically has to cover at the parent boundary.
interface SubtreeResult {
  alongReach: number;
  streets: Street[];
  buildings: Building[];
}

// DirReaches — estimated final road length (alongReach) and perpendicular
// extent (perpReach) for a directory's layout, measured in the directory's
// own local frame. Used to seed the phantom in child recursions with the
// parent's exact final road length, so deep grandchildren can't be placed
// on top of an ancestor whose road grew after this dir was placed.
export interface DirReaches {
  /** Road length in this dir's along axis: max(side0 far-edge, side1 far-edge) + endPad. */
  alongReach: number;
  /** Max distance from this dir's centerline along its perp axis. */
  perpReach: number;
}

// estimateDirReaches(dir, lineStats, byteStats, parentStreetWidth, cache)
//   → bottom-up walk computing each dir's alongReach and perpReach by
//     simulating alphabetical placement with alternating sides. Memoizes
//     results in `cache` so each dir is visited once.
//
// The estimate is a tight upper bound on the actual placement: placeChild
// may pick smaller stems when obstacles allow, but it never picks LARGER
// stems for the smallest-stem variant in an empty occupancy — and the
// pre-pass runs without occupancy constraints. Used for phantom sizing
// only, where over-sizing has no observable effect (the phantom strip is
// already outside the originPad clearance), but under-sizing reintroduces
// the bug.
export function estimateDirReaches(
  dir: DirLike,
  lineStats: RangeStat,
  byteStats: RangeStat,
  parentStreetWidth: number | undefined,
  cache: Map<DirLike, DirReaches>
): DirReaches {
  const cached = cache.get(dir);
  if (cached) return cached;

  const streetLayout = STREET_LAYOUT.value;
  const buildingGap = streetLayout.BUILDING_GAP;
  const streetGap = streetLayout.STREET_GAP;
  const parentJoinPad = streetLayout.PARENT_JOIN_PAD;
  const rootEndPad = streetLayout.ROOT_END_PAD;
  const bldgDims = BUILDING_DIMENSIONS.value;
  const distFromRoad = bldgDims.DISTANCE_FROM_ROAD;
  const gemSizing = GEM_SIZING.value;
  const gemRadiusFrac = gemSizing.RADIUS_AS_STREET_FRAC;

  // Padding chain — mirrors _layoutDir exactly so the estimate matches the
  // real placement's bounds.
  const myStreetWidth = _streetWidthForDir(dir);
  const openEndPad = myStreetWidth / 2 + distFromRoad;
  const joinEndBaseline = parentStreetWidth ? parentStreetWidth / 2 + parentJoinPad : rootEndPad;
  const endPad = parentStreetWidth
    ? Math.max(joinEndBaseline, openEndPad)
    : Math.max(rootEndPad, openEndPad);
  const gemRadius = Math.max(myStreetWidth * gemRadiusFrac, gemSizing.MIN_RADIUS);
  const gemDiameter = gemRadius * 2;
  const gemClearance = gemDiameter * GEM_CLEARANCE_AS_GEM_WIDTH_FRAC;
  const originPad = !parentStreetWidth
    ? Math.max(endPad, myStreetWidth * (0.5 + gemRadiusFrac) + gemClearance)
    : joinEndBaseline;

  const children = ((dir.children || []) as TreeLike[])
    .filter((c) => c.type === NodeKind.File || c.type === NodeKind.Directory)
    .slice()
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  // Track the far edge of placed children on each side. -Infinity means no
  // child placed there yet; first child on a side sits at stem=phantomBumpStem
  // (the stem the grandparent-body phantom forces), subsequent children add
  // max(prevGap, myGap) + alongContrib (buildingGap for a building, streetGap
  // for a side street).
  //
  // phantomBumpStem accounts for the actual placement's first-child stem
  // being NOT simply originPad: when the grandparent body's phantom occupies
  // ±halfP_parent in this dir's along axis, the new rect's along range
  // [stem - alongContrib/2, stem + alongContrib/2] must clear that strip
  // with the gap on each side → stem ≥ halfP_parent + alongContrib/2 + gap.
  // For the root call (no parent body), parentBodyHalf=0 and this reduces to
  // alongContrib/2 + gap, which is always ≤ originPad anyway.
  const parentBodyHalf = parentStreetWidth ? parentStreetWidth / 2 : 0;
  const sideFarEdge: [number, number] = [-Infinity, -Infinity];
  // Gap of the last child placed on each side, so the next child's clearance is
  // max(prevGap, myGap) — mirrors findSmallestValidStem's max-of-both-kinds.
  const sidePrevGap: [number, number] = [0, 0];
  let perpReach = myStreetWidth / 2; // dir's own road body extends ±halfP

  for (const child of children) {
    let alongContrib: number;
    let perpContrib: number;
    // A building reserves buildingGap; a branching side street reserves streetGap.
    let myGap: number;
    if (child.type === NodeKind.File) {
      const dim = getBuildingDimensions(child as FileLike, lineStats, byteStats);
      alongContrib = dim.w;
      perpContrib = myStreetWidth / 2 + distFromRoad + dim.d;
      myGap = buildingGap;
    } else {
      const sub = estimateDirReaches(child as DirLike, lineStats, byteStats, myStreetWidth, cache);
      // A perpendicular subdir occupies 2*subdir.perpReach in the parent's
      // along axis (both sides of the subdir's road) and subdir.alongReach
      // in the parent's perp axis (one-sided, from join to end).
      alongContrib = 2 * sub.perpReach;
      perpContrib = sub.alongReach;
      myGap = streetGap;
    }
    // Pick the side with smaller far edge (matches placeChild's smallest-stem
    // tiebreaking with empty occupancy).
    const side = sideFarEdge[0] <= sideFarEdge[1] ? 0 : 1;
    if (sideFarEdge[side] === -Infinity) {
      // First child clears the parent's street BODY, not a sibling — that gap is
      // the building baseline (the branch-join spacing comes from originPad /
      // PARENT_JOIN_PAD), so the sibling street gap is NOT applied here.
      const phantomBumpStem = parentBodyHalf + alongContrib / 2 + buildingGap;
      const stem = Math.max(originPad, phantomBumpStem);
      sideFarEdge[side] = stem + alongContrib / 2;
    } else {
      sideFarEdge[side] = sideFarEdge[side] + Math.max(sidePrevGap[side], myGap) + alongContrib;
    }
    sidePrevGap[side] = myGap;
    if (perpContrib > perpReach) perpReach = perpContrib;
  }

  const farLeft = sideFarEdge[0] === -Infinity ? originPad : sideFarEdge[0];
  const farRight = sideFarEdge[1] === -Infinity ? originPad : sideFarEdge[1];
  const maxBoundary = Math.max(farLeft, farRight);
  const alongReach = Math.max(maxBoundary + endPad, originPad + endPad);

  const result: DirReaches = { alongReach, perpReach };
  cache.set(dir, result);
  return result;
}

// _layoutDir(dir, originX, originY, orientation, result, parentStreetWidth,
//             lineStats, byteStats, occupancy)
//   → fills `result` with this subtree's content in WORLD frame (relative to
//     the passed origin). Inserts every committed rect into `occupancy`.
//
// occupancy semantics:
//   At the TOP-LEVEL call, occupancy is the GLOBAL occupancy. Children placed
//   directly under root see each other through it.
//   At a SUBDIR call (from the subdir branch below), occupancy is a fresh
//   LOCAL occupancy so the subdir's grandchildren only see each other within
//   the subtree during pre-compute. After the recursion returns, the caller
//   translates the subtree to world coords and inserts everything into the
//   ACTUAL global occupancy.
function _layoutDir(
  dir: DirLike,
  originX: number,
  originY: number,
  orientation: StreetAxis,
  result: SubtreeResult,
  parentStreetWidth: number | undefined,
  lineStats: RangeStat,
  byteStats: RangeStat,
  occupancy: WorldOccupancy,
  reachCache: Map<DirLike, DirReaches>,
  trace?: StemPlacementTrace,
  /** Parent's FINAL along-axis road length, pre-computed by
   *  estimateDirReaches. Used to size the phantom's perp range exactly
   *  (covering the parent's full road body, not just the extent at this
   *  recursion's start). Undefined at the top-level call where no parent
   *  body exists. */
  parentFinalAlongReach?: number
): void {
  // ----- Tunables (one .value per call) -----
  const streetLayout = STREET_LAYOUT.value;
  const buildingGap = streetLayout.BUILDING_GAP;
  const streetGap = streetLayout.STREET_GAP;
  const parentJoinPad = streetLayout.PARENT_JOIN_PAD;
  const rootEndPad = streetLayout.ROOT_END_PAD;
  const bldgDims = BUILDING_DIMENSIONS.value;
  const distFromRoad = bldgDims.DISTANCE_FROM_ROAD;

  // ----- Padding chain -----
  const myStreetWidth = _streetWidthForDir(dir);
  const openEndPad = myStreetWidth / 2 + distFromRoad;
  const joinEndBaseline = parentStreetWidth ? parentStreetWidth / 2 + parentJoinPad : rootEndPad;
  const endPad = parentStreetWidth
    ? Math.max(joinEndBaseline, openEndPad)
    : Math.max(rootEndPad, openEndPad);
  const gemSizing = GEM_SIZING.value;
  const gemRadiusFrac = gemSizing.RADIUS_AS_STREET_FRAC;
  // Derive the plaza clearance from the gem's own diameter so the dead
  // space scales with the gem. Mirror the same MIN_RADIUS floor that
  // city/components/gem/mesh.ts uses when sizing the actual gem geometry so the layout
  // pad never under-reserves for a narrow root street.
  const gemRadius = Math.max(myStreetWidth * gemRadiusFrac, gemSizing.MIN_RADIUS);
  const gemDiameter = gemRadius * 2;
  const gemClearance = gemDiameter * GEM_CLEARANCE_AS_GEM_WIDTH_FRAC;
  const originPad = !parentStreetWidth
    ? Math.max(endPad, myStreetWidth * (0.5 + gemRadiusFrac) + gemClearance)
    : joinEndBaseline;

  // ----- Pre-seed parent's street body into occupancy. Forces children's
  // stems to clear the parent main street's perp footprint via a
  // phantom-rect collision check.
  //
  // Phantom geometry in THIS dir's local frame:
  //   - Along this dir's ALONG axis: spans ±parentStreetWidth/2 (parent's
  //     width). This dir's join end sits at along=0; the parent's body
  //     extends to ±parentW/2 on either side of the join.
  //   - Along this dir's PERP axis: parent's FINAL road length, supplied
  //     by the caller from a bottom-up pre-pass (estimateDirReaches).
  //
  // Skipped at the root call (parentStreetWidth undefined), where no parent
  // body exists. -----
  if (parentStreetWidth !== undefined && parentStreetWidth > 0) {
    const halfP = parentStreetWidth / 2;
    const PHANTOM_FAR = 1e9;
    // +1 unit absorbs floating-point drift between the estimate (computed
    // in the pre-pass) and the actual placement (computed here).
    const phantomReach =
      parentFinalAlongReach !== undefined ? parentFinalAlongReach + 1 : PHANTOM_FAR;
    const phantomMinX = orientation === StreetAxis.X ? -halfP : -phantomReach;
    const phantomMaxX = orientation === StreetAxis.X ? +halfP : +phantomReach;
    const phantomMinY = orientation === StreetAxis.Y ? -halfP : -phantomReach;
    const phantomMaxY = orientation === StreetAxis.Y ? +halfP : +phantomReach;
    occupancy.insert({
      minX: phantomMinX,
      minY: phantomMinY,
      maxX: phantomMaxX,
      maxY: phantomMaxY,
      kind: WorldRectKind.Street,
      // Marks this as the PARENT body, not a sibling — the sibling-gap logic
      // skips the street gap for it (the join clearance is PARENT_JOIN_PAD).
      parentBody: true,
      // Phantom ref — never read by findSmallestValidStem or the result
      // arrays (the phantom lives only in the local occupancy and never
      // appears in CityLayout). Typed as Street to satisfy WorldRect.ref.
      ref: {
        x: 0,
        y: 0,
        length: 0,
        width: parentStreetWidth,
        orientation: orientation === StreetAxis.X ? StreetAxis.Y : StreetAxis.X,
        label: '__phantom_parent_body__',
        dir: null as unknown as Street['dir'],
      } as Street,
    });
  }

  // ----- Sort children alphabetically -----
  const children = ((dir.children || []) as TreeLike[])
    .filter((c) => c.type === NodeKind.File || c.type === NodeKind.Directory)
    .slice()
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  const subOrient = orientation === StreetAxis.X ? StreetAxis.Y : StreetAxis.X;

  // ----- Place children one by one -----
  // priorStems tracks the previous SAME-SIDE placement's chosen stem. Each
  // entry is the alphabetical-monotonic floor for that side only — a child
  // on side A is allowed to fit at a stem lower than a recent predecessor
  // on side B, since opposite-side neighbors don't physically collide. This
  // is what lets pairs like `ja.cjs` (side 1) and `ja.d.cts` (side 0) share
  // a stem range instead of being forced apart by a cross-side
  // alphabetical-monotonic constraint.
  const priorStems: [number, number] = [originPad, originPad];
  // maxBoundaryAlong tracks the far edge of the last-placed child, used to
  // size the own street at the end.
  let maxBoundaryAlong = originPad;

  for (const child of children) {
    if (child.type === NodeKind.File) {
      // ----- File leaf: compute rects in child-local frame -----
      const dim = getBuildingDimensions(child as FileLike, lineStats, byteStats);
      const along = dim.w;
      const perpDepth = dim.d;
      const perpCenter = myStreetWidth / 2 + distFromRoad + perpDepth / 2;
      let bx: number, by: number, bw: number, bd: number;
      if (orientation === StreetAxis.X) {
        bx = 0;
        by = perpCenter;
        bw = along;
        bd = perpDepth;
      } else {
        bx = perpCenter;
        by = 0;
        bw = perpDepth;
        bd = along;
      }
      // Child-local rects: building. Used by placeChild for variant
      // evaluation (collision testing against occupancy).
      const childRects: Rect[] = [{ x: bx, y: by, w: bw, d: bd }];

      // Pick the best (side, mirror, stem) variant.
      const variants: VariantTrace[] = [];
      const placed = placeChild(
        {
          childRects,
          parentOrient: orientation,
          parentOriginX: originX,
          parentOriginY: originY,
          priorStem: Math.max(priorStems[0], priorStems[1]),
          priorStems,
          originPad,
          buildingGap,
          streetGap,
          childKind: WorldRectKind.Building,
          occupancy,
        },
        trace ? { variants } : undefined
      );
      if (trace) {
        const chosenIdx = variants.findIndex(
          (v) => v.side === placed.side && v.mirror === placed.mirror
        );
        if (chosenIdx < 0) {
          throw new Error(
            `[stem-diag] placed variant not found in trace.variants — placeChild invariant broken (side=${placed.side}, mirror=${placed.mirror})`
          );
        }
        const chosenPriorStem = priorStems[placed.side];
        trace.placements.push({
          childKind: 'file',
          childLabel: child.name ?? '?',
          childPath: String((child as DirLike).path ?? ''),
          parentPath: dir.path ?? '',
          baseline: Math.max(chosenPriorStem, originPad),
          priorStem: chosenPriorStem,
          originPad,
          chosen: variants[chosenIdx],
          others: variants.filter((_, i) => i !== chosenIdx),
        });
      }

      // Translate child-local rects to world frame using chosen flips + stem.
      const { flipX, flipY } = computeFlips(orientation, placed.side, placed.mirror);
      const buildingLocal = applyFlips({ x: bx, y: by, w: bw, d: bd }, flipX, flipY);

      const stemAlong = placed.stem;
      const buildingWorldX =
        buildingLocal.x + originX + (orientation === StreetAxis.X ? stemAlong : 0);
      const buildingWorldY =
        buildingLocal.y + originY + (orientation === StreetAxis.Y ? stemAlong : 0);

      // Door orientation: side 0 maps to the flipped perp position
      // (flipY=true for X-orient, flipX=true for Y-orient); the door points
      // toward the parent street.
      let orient: BuildingOrient;
      if (orientation === StreetAxis.X) {
        orient = placed.side === 0 ? BuildingOrient.South : BuildingOrient.North;
      } else {
        orient = placed.side === 0 ? BuildingOrient.East : BuildingOrient.West;
      }
      // For mirror-invariant rect lists (files always are — buildings are
      // centered on the stem along the parent's along axis), placeChild will
      // never pick mirror=true (the tiebreak prefers non-mirror), so this
      // branch is a no-op in practice. Kept defensively in case a future
      // caller passes a non-symmetric file rect.
      if (placed.mirror) orient = _mirrorOrient(orient, flipX, flipY);

      const buildingRect: Building = {
        x: buildingWorldX,
        y: buildingWorldY,
        w: buildingLocal.w,
        d: buildingLocal.d,
        h: dim.h,
        floors: dim.floors,
        file: child as unknown as Building['file'],
        color: null as unknown as string,
        orient,
      };

      result.buildings.push(buildingRect);
      const buildingWorldRect: WorldRect = {
        minX: buildingWorldX - buildingLocal.w / 2,
        minY: buildingWorldY - buildingLocal.d / 2,
        maxX: buildingWorldX + buildingLocal.w / 2,
        maxY: buildingWorldY + buildingLocal.d / 2,
        kind: WorldRectKind.Building,
        ref: buildingRect,
      };
      occupancy.insert(buildingWorldRect);

      priorStems[placed.side] = placed.stem;
      const boundaryHigh = placed.stem + along / 2;
      if (boundaryHigh > maxBoundaryAlong) maxBoundaryAlong = boundaryHigh;
    } else {
      // ----- Subdir: recurse in a local occupancy, then commit -----
      const subStreetWidth = _streetWidthForDir(child as DirLike);
      const childResult: SubtreeResult = {
        alongReach: subStreetWidth / 2,
        streets: [],
        buildings: [],
      };
      const localOccupancy = new WorldOccupancy();
      // Pass THIS dir's pre-computed final alongReach as the child's
      // parentFinalAlongReach — that's the exact perp-axis bound the
      // child's phantom needs to cover.
      const myReaches = reachCache.get(dir);
      _layoutDir(
        child as DirLike,
        0,
        0,
        subOrient,
        childResult,
        myStreetWidth,
        lineStats,
        byteStats,
        localOccupancy,
        reachCache,
        trace,
        myReaches?.alongReach
      );

      // Build child-local rect list from the subtree result. These are the
      // rects placeChild evaluates for variants (collision testing in the
      // parent's frame).
      const childRects: Rect[] = [];
      for (const s of childResult.streets) {
        childRects.push(rectOfStreet(s));
      }
      for (const b of childResult.buildings) {
        childRects.push(rectOfBuilding(b));
      }

      // Pick variant against the parent's occupancy.
      const variants: VariantTrace[] = [];
      const placed = placeChild(
        {
          childRects,
          parentOrient: orientation,
          parentOriginX: originX,
          parentOriginY: originY,
          priorStem: Math.max(priorStems[0], priorStems[1]),
          priorStems,
          originPad,
          buildingGap,
          streetGap,
          childKind: WorldRectKind.Street,
          occupancy,
        },
        trace ? { variants } : undefined
      );
      if (trace) {
        const chosenIdx = variants.findIndex(
          (v) => v.side === placed.side && v.mirror === placed.mirror
        );
        if (chosenIdx < 0) {
          throw new Error(
            `[stem-diag] placed variant not found in trace.variants — placeChild invariant broken (side=${placed.side}, mirror=${placed.mirror})`
          );
        }
        const chosenPriorStem = priorStems[placed.side];
        trace.placements.push({
          childKind: 'dir',
          childLabel: child.name ?? '?',
          childPath: String((child as DirLike).path ?? ''),
          parentPath: dir.path ?? '',
          baseline: Math.max(chosenPriorStem, originPad),
          priorStem: chosenPriorStem,
          originPad,
          chosen: variants[chosenIdx],
          others: variants.filter((_, i) => i !== chosenIdx),
        });
      }

      // Translate the subtree's contents to world coords and commit. The
      // subAnchor is the child's origin in the parent's world frame: along
      // the parent's along axis we shift by stem; perp axis stays at origin.
      const { flipX, flipY } = computeFlips(orientation, placed.side, placed.mirror);
      const subAnchorX = orientation === StreetAxis.X ? originX + placed.stem : originX;
      const subAnchorY = orientation === StreetAxis.X ? originY : originY + placed.stem;

      for (const s of childResult.streets) {
        const isXOrient = s.orientation === StreetAxis.X;
        const worldStreet: Street = {
          x: (flipX ? -s.x : s.x) + subAnchorX,
          y: (flipY ? -s.y : s.y) + subAnchorY,
          length: s.length,
          width: s.width,
          orientation: s.orientation,
          label: s.label,
          dir: s.dir,
        };
        result.streets.push(worldStreet);
        const halfAlongX = isXOrient ? s.length / 2 : s.width / 2;
        const halfAlongY = isXOrient ? s.width / 2 : s.length / 2;
        const streetWorldRect: WorldRect = {
          minX: worldStreet.x - halfAlongX,
          minY: worldStreet.y - halfAlongY,
          maxX: worldStreet.x + halfAlongX,
          maxY: worldStreet.y + halfAlongY,
          kind: WorldRectKind.Street,
          ref: worldStreet,
        };
        occupancy.insert(streetWorldRect);
      }
      for (const b of childResult.buildings) {
        const worldBuilding: Building = {
          x: (flipX ? -b.x : b.x) + subAnchorX,
          y: (flipY ? -b.y : b.y) + subAnchorY,
          w: b.w,
          d: b.d,
          h: b.h,
          floors: b.floors,
          file: b.file,
          color: b.color,
          orient: _mirrorOrient(b.orient, flipX, flipY),
        };
        result.buildings.push(worldBuilding);
        const buildingWorldRect: WorldRect = {
          minX: worldBuilding.x - b.w / 2,
          minY: worldBuilding.y - b.d / 2,
          maxX: worldBuilding.x + b.w / 2,
          maxY: worldBuilding.y + b.d / 2,
          kind: WorldRectKind.Building,
          ref: worldBuilding,
        };
        occupancy.insert(buildingWorldRect);
      }

      priorStems[placed.side] = placed.stem;
      const boundaryHigh = placed.stem + childResult.alongReach;
      if (boundaryHigh > maxBoundaryAlong) maxBoundaryAlong = boundaryHigh;
    }
  }

  // ----- Emit own main street -----
  const streetLength = Math.max(maxBoundaryAlong + endPad, originPad + endPad);
  let streetCenterX = originX;
  let streetCenterY = originY;
  if (orientation === StreetAxis.X) {
    streetCenterX = originX + streetLength / 2;
  } else {
    streetCenterY = originY + streetLength / 2;
  }
  const ownStreet: Street = {
    x: streetCenterX,
    y: streetCenterY,
    length: streetLength,
    width: myStreetWidth,
    orientation,
    label: dir.name || '',
    dir: dir as unknown as Street['dir'],
  };
  result.streets.push(ownStreet);
  const halfStreetAlongX = orientation === StreetAxis.X ? streetLength / 2 : myStreetWidth / 2;
  const halfStreetAlongY = orientation === StreetAxis.X ? myStreetWidth / 2 : streetLength / 2;
  occupancy.insert({
    minX: streetCenterX - halfStreetAlongX,
    minY: streetCenterY - halfStreetAlongY,
    maxX: streetCenterX + halfStreetAlongX,
    maxY: streetCenterY + halfStreetAlongY,
    kind: WorldRectKind.Street,
    ref: ownStreet,
  });
}

// -----------------------------------------------------------------------------
// layoutCity(manifest) -> { streets, buildings, lineStats, byteStats }
//
// Top-level layout function. Walks the directory tree and produces a STREET
// NETWORK in world coordinates: each directory becomes a street, files line
// the street's sides as buildings, and subdirectories branch off as
// perpendicular streets (recursively). Uses a global-occupancy packer
// (placeChild + findSmallestValidStem) to fit each child into the smallest
// stem offset that avoids overlap with anything already placed.
//
// Return shape:
//   streets:   [{ x, y, length, width, orientation, label, dir }]
//   buildings: [{ x, y, w, d, h, color, file, orient, hitBox: { x, y, w, h } }]
//   lineStats / byteStats: per-project ranges used by getBuildingDimensions.
//
// `color` starts as null — the renderer must call getBuildingColor before drawing.
// -----------------------------------------------------------------------------
export function layoutCity(manifest: ManifestLike | DirLike): CityLayout {
  return _layoutCityInternal(manifest, undefined).layout;
}

// layoutCityWithTrace — same layout output, plus a StemPlacementTrace
// recording each placeChild decision for the "Diagnose stem placement"
// debug button.
export function layoutCityWithTrace(manifest: ManifestLike | DirLike): {
  layout: CityLayout;
  trace: StemPlacementTrace;
} {
  return _layoutCityInternal(manifest, { placements: [] });
}

function _layoutCityInternal(
  manifest: ManifestLike | DirLike,
  trace: StemPlacementTrace | undefined
): { layout: CityLayout; trace: StemPlacementTrace } {
  const tree = ((manifest as { tree?: DirLike }).tree ?? manifest) as DirLike;
  const result: CityLayout = {
    streets: [],
    buildings: [],
    lineStats: { min: 1, max: 1 },
    byteStats: { min: 1, max: 1 },
  };

  const stats = computeFileStats(tree);
  result.lineStats = stats.lines;
  result.byteStats = stats.bytes;

  const occupancy = new WorldOccupancy();
  const subResult: SubtreeResult = {
    alongReach: 0,
    streets: result.streets,
    buildings: result.buildings,
  };
  // Bottom-up pre-pass: each dir's alongReach (final road length) is needed
  // when its children seed their phantoms with the exact parent body extent.
  const reachCache = new Map<DirLike, DirReaches>();
  estimateDirReaches(tree, stats.lines, stats.bytes, undefined, reachCache);
  _layoutDir(
    tree,
    0,
    0,
    StreetAxis.X,
    subResult,
    undefined,
    stats.lines,
    stats.bytes,
    occupancy,
    reachCache,
    trace
  );

  for (const street of result.streets) {
    if ((street.dir as unknown) === (tree as unknown)) {
      street.isRoot = true;
      break;
    }
  }

  _markJoinSides(result.streets);

  return { layout: result, trace: trace ?? { placements: [] } };
}

// -----------------------------------------------------------------------------
// _streetWidthForDir(dir) -> number
//
// Maps a directory's descendants to a tier and returns the visual width of
// its street. Larger directories get wider boulevards.
// -----------------------------------------------------------------------------
export function _streetWidthForDir(dir: DirLike | null | undefined): number {
  const count = (dir && (dir.descendants_count || dir.children_count)) || 0;
  return getStreetWidth(count, STREET_TIERS.value.TIERS);
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
export function _mirrorOrient(
  orient: BuildingOrient,
  negateX: boolean,
  negateY: boolean
): BuildingOrient {
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
// called from world after layoutCity for live debugging — the test
// suite (assertNoOverlap) covers synthetic trees but visual bugs surface
// only against real manifests, where this helper helps locate them.
//
// Whitelist:
//   - 't-junction': two perpendicular streets joined at a T (one street's
//     length-axis endpoint sits on the other's centerline within both half-
//     widths). This is the documented flat join the renderer fuses.
// Anything else is 'unexpected'.
//
// `_isStreetJoinPair` mirrors the geometry test in tests/city/layout.test.ts
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

// Layout overlap categories use the same kind values as WorldRect
// (street / building), so reuse WorldRectKind instead of defining a
// parallel union that could drift.
export type LayoutOverlapCategory = 't-junction' | 'unexpected';

export interface LayoutOverlap {
  kindA: WorldRectKind;
  kindB: WorldRectKind;
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
}): LayoutOverlap[] {
  type Tagged =
    | { kind: WorldRectKind.Street; rect: Rect; label: string; ref: Street }
    | { kind: WorldRectKind.Building; rect: Rect; label: string; ref: Building };
  const all: Tagged[] = [];
  for (const s of layout.streets) {
    all.push({
      kind: WorldRectKind.Street,
      rect: rectOfStreet(s),
      label: s.dir?.path ?? s.label ?? '(root)',
      ref: s,
    });
  }
  for (const b of layout.buildings) {
    all.push({
      kind: WorldRectKind.Building,
      rect: rectOfBuilding(b),
      label: b.file?.path ?? b.file?.name ?? '?',
      ref: b,
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
      if (
        A.kind === WorldRectKind.Street &&
        B.kind === WorldRectKind.Street &&
        _isStreetJoinPair(A.ref, B.ref)
      ) {
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
