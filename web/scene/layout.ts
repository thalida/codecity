// layout.ts — Street/building placement algorithm. Pure data output, no DOM or Three.js.
//   Building: { x, y, w, d, h, color, file, orient }
//   Street:   { x, y, w, d, label, dir }
//
// All tunables come from the nanostores under src/config/. Tests that
// need different values mutate the stores via .setKey() in setup +
// restore in teardown — keeps the production callsites argument-free.

import { STREET_LAYOUT, STREET_TIERS, BUILDING_DIMENSIONS, GEM_SIZING } from '@/config/index.js';
import type { StreetTier } from '@/config/street.js';
import { BuildingOrient, JoinSide, NodeKind, StreetAxis } from '@/types';
import type { Building, BuildingPath, CityLayout, RangeStat, Street } from '@/types';
import { parentDirPath } from './path.js';

// Structural shapes — kept lenient so test fixtures (which omit fields the
// helpers don't read, like name/path on intermediate nodes) stay
// compatible. Real callers pass full Manifest / TreeNode / FileNode
// instances which structurally satisfy these.
interface FileLike {
  type?: string;
  name?: string;
  lines?: number;
  size?: number;
  [k: string]: unknown;
}
interface DirLike {
  type?: string;
  name?: string;
  path?: string;
  children?: TreeLike[];
  descendants_count?: number;
  children_count?: number;
  [k: string]: unknown;
}
type TreeLike = FileLike | DirLike;

// Rect — axis-aligned bounding rectangle in some 2D frame. Used by the
// occupancy-based packer in _layoutDir to test whether a candidate
// placement overlaps already-placed siblings. (x, y) is the rect's CENTER;
// w/d are the full width/depth (matches Building/Street conventions).
export interface Rect {
  x: number;
  y: number;
  w: number;
  d: number;
}

// LocalChildLayout — what each child contributes to its parent's packing.
//   rects: child geometry in a local frame where stem-x = 0 along the parent
//          axis and the child's content extends in +perp direction (side 1).
//   along: extent of the child along the parent's long axis (== bbox width
//          along that axis).
//   buildings/streets/paths: the same content as `rects`, kept typed for
//          translation back into result arrays once the placement is chosen.
interface LocalChildLayout {
  along: number;
  alongLow: number; // local-frame x of the leftmost rect edge (≤ 0 typically)
  rects: Rect[];
  streets: Street[];
  buildings: Building[];
  paths: BuildingPath[];
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
// reports the touching case as a sub-femto-unit overlap. The OVERLAP_EPS
// threshold below treats overlaps smaller than a billionth of a world
// unit as touching — far below the smallest meaningful geometry (paths
// are ~2 units; the smallest building is 6 units), but well above
// double-precision rounding noise (~7e-15 for our coordinate range).
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

// _overlapsAny(rects, occupancy) -> boolean
//
// True iff any rect in `rects` intersects any rect in `occupancy`. Used by
// the placement loop to reject candidate stem-x positions that would cause
// a sibling collision. Linear scan; for the manifest sizes codecity targets
// this is comfortably under the layout-pass budget.
function _overlapsAny(rects: Rect[], occupancy: Rect[]): boolean {
  for (let i = 0; i < rects.length; i++) {
    for (let j = 0; j < occupancy.length; j++) {
      if (_rectsOverlap(rects[i], occupancy[j])) return true;
    }
  }
  return false;
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

// _nextEventX(stemX, childRectsAtStemX, occupancy, axisAlong) -> number
//
// When a candidate stem-x produces an overlap, returns the smallest x' > stemX
// such that retrying at x' clears at least one (child, occupancy) overlapping
// pair. For each overlapping (c, o) pair, computes the stemX shift such that
// c's left edge lands at o's right edge; returns stemX + minimum such shift.
// The placement loop is responsible for adding any childGap separation policy.
function _nextEventX(
  stemX: number,
  childRectsAtStemX: Rect[],
  occupancy: Rect[],
  axisAlong: 'x' | 'y'
): number {
  let bestAdvance = Infinity;
  for (let i = 0; i < childRectsAtStemX.length; i++) {
    const c = childRectsAtStemX[i];
    const cLeft = axisAlong === 'x' ? c.x - c.w / 2 : c.y - c.d / 2;
    for (let j = 0; j < occupancy.length; j++) {
      const o = occupancy[j];
      if (!_rectsOverlap(c, o)) continue;
      const oRight = axisAlong === 'x' ? o.x + o.w / 2 : o.y + o.d / 2;
      // Advance candidateStemX such that c's left edge ends up at oRight.
      const advance = oRight - cLeft;
      if (advance > 0 && advance < bestAdvance) bestAdvance = advance;
    }
  }
  if (bestAdvance === Infinity) return stemX + 1; // shouldn't happen if overlap occurred
  return stemX + bestAdvance;
}

// _translateChildRects(rects, originX, originY, stemX, sideIdx, parentOrient) -> Rect[]
//
// Translate a child's local-frame rects into the parent's world frame. side 0
// uses the negate flag matching the existing _mirrorOrient rule:
//   parent X-orient: side 0 negateY (south), side 1 no negate (north)
//   parent Y-orient: side 0 negateX (west),  side 1 no negate (east)
function _translateChildRects(
  rects: Rect[],
  originX: number,
  originY: number,
  stemX: number,
  sideIdx: 0 | 1,
  parentOrient: StreetAxis
): Rect[] {
  const out: Rect[] = new Array(rects.length);
  const negateY = parentOrient === StreetAxis.X && sideIdx === 0;
  const negateX = parentOrient === StreetAxis.Y && sideIdx === 0;
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    let lx = r.x;
    let ly = r.y;
    if (parentOrient === StreetAxis.X) {
      lx += stemX;
    } else {
      ly += stemX;
    }
    out[i] = {
      x: (negateX ? -lx : lx) + originX,
      y: (negateY ? -ly : ly) + originY,
      w: r.w,
      d: r.d,
    };
  }
  return out;
}

// _sideArea(occupancy) -> number
//
// Sum of w*d over all rects in this side's occupancy. Used as the
// tiebreaker when computing preferredSide in _layoutDir so the city grows symmetrically.
function _sideArea(occupancy: Rect[]): number {
  let area = 0;
  for (let i = 0; i < occupancy.length; i++) {
    area += occupancy[i].w * occupancy[i].d;
  }
  return area;
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

  // Depth == width keeps footprints square so tall thin towers don't
  // become deep slabs.
  return {
    w: Math.round(width * 10) / 10,
    d: Math.round(width * 10) / 10,
    h: Math.round(height * 10) / 10,
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
// -----------------------------------------------------------------------------
export function layoutCity(manifest: ManifestLike | DirLike): CityLayout {
  const tree = ((manifest as ManifestLike).tree as DirLike | undefined) || (manifest as DirLike);
  const result: CityLayout = {
    streets: [],
    buildings: [],
    paths: [],
    lineStats: { min: 1, max: 1 },
    byteStats: { min: 1, max: 1 },
  };

  // Compute the project's own ranges once and stash on `result` so the
  // recursion below can pass them to every getBuildingDimensions call
  // (and callers can keep them for later use).
  const stats = computeFileStats(tree);
  result.lineStats = stats.lines;
  result.byteStats = stats.bytes;

  _layoutDir(tree, 0, 0, StreetAxis.X, result, undefined, stats.lines, stats.bytes);

  // Mark the root-dir street so the renderer can draw a distinct "start of
  // repo" marker at its origin end.
  for (const street of result.streets) {
    if ((street.dir as unknown) === (tree as unknown)) {
      street.isRoot = true;
      break;
    }
  }

  // For each non-root street, figure out which end joins its parent — the
  // renderer flattens that end and only rounds the open end. Computed
  // from world coordinates rather than tracked through the recursion's
  // mirror flags, since post-processing is simpler than threading the
  // bookkeeping through every transform step.
  _markJoinSides(result.streets);

  return result;
}

// -----------------------------------------------------------------------------
// _streetWidthForDir(dir) -> number
//
// Maps a directory's descendants to a tier and returns the visual width of
// its street. Larger directories get wider boulevards.
// -----------------------------------------------------------------------------
function _streetWidthForDir(dir: DirLike | null | undefined): number {
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

function _markJoinSides(streets: StreetWithJoin[]): void {
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
// _layoutDir(dir, originX, originY, orientation, result)
//
// Recursively places a directory and its descendants into `result` (in WORLD
// coordinates).
//
//   originX, originY — world position of this street's START (the end nearest
//                      the parent street; for the root, this is (0, 0))
//   orientation       — 'x' or 'y'; the axis the street extends along
//
// Algorithm:
//   1. Sort all children (files + subdirs) alphabetically by name.
//   2. Pre-compute each subdir's layout in its own local frame and measure
//      its bounding box (so we can space siblings correctly).
//   3. Walk children in order, placing each one along the street with a
//      single shared cursor. Alternate sides (primary/secondary) as we go:
//        - X-street primary = SOUTH, secondary = NORTH
//        - Y-street primary = WEST,  secondary = EAST
//      Subdirs on the secondary side branch in the +perp direction (default);
//      subdirs on the primary side branch in the -perp direction (we mirror
//      their local layout by negating the perp axis).
//
// Buildings are sized so their LONG side (dim.w) runs along the street.
// Door faces back toward the street when visible (orient='s' or 'e'); when
// the file is on the secondary side the door is on a hidden face ('n' or 'w').
// -----------------------------------------------------------------------------
function _layoutDir(
  dir: DirLike,
  originX: number,
  originY: number,
  orientation: StreetAxis,
  result: { streets: Street[]; buildings: Building[]; paths: BuildingPath[] },
  parentStreetWidth: number | undefined,
  lineStats: RangeStat,
  byteStats: RangeStat
): void {
  // User-tunable gaps. Read fresh from the stores each call so tests /
  // runtime mutations take effect without reseating the recursion.
  // Street-packing gaps live in STREET_LAYOUT; the building-to-sidewalk
  // gap belongs to BUILDING_DIMENSIONS (it's a building-side concept).
  const streetLayout = STREET_LAYOUT.get();
  const childGap = streetLayout.CHILD_GAP;
  const parentJoinPad = streetLayout.PARENT_JOIN_PAD;
  const rootEndPad = streetLayout.ROOT_END_PAD;
  const bldgDims = BUILDING_DIMENSIONS.get();
  const bldgPathLength = bldgDims.PATH_LENGTH;
  const pathWidthFrac = bldgDims.PATH_WIDTH_FRAC;

  // Widths — this street's visual width comes from its descendants count, and
  // end-padding depends on the PARENT street's width so children don't cross
  // the parent intersection.
  const myStreetWidth = _streetWidthForDir(dir);

  // The street's rounded cap takes up streetWidth/2 of the length at the
  // OPEN end. To keep the last building (and its path connector) clear
  // of the curve, the open-end pad must be at least cap radius + a small
  // buffer (re-using bldgPathLength so the buffer matches the building↔
  // sidewalk gap visually). Joining ends are flat — they don't need this.
  const openEndPad = myStreetWidth / 2 + bldgPathLength;
  const joinEndBaseline = parentStreetWidth ? parentStreetWidth / 2 + parentJoinPad : rootEndPad;

  // endPad is applied at the CHILD'S local-high end (the open end after
  // mirroring/transform). For non-root streets this end is always rounded,
  // so it must clear the cap. For the root, both ends are open / rounded,
  // so we'll also widen its origin-end pad below.
  const endPad = parentStreetWidth
    ? Math.max(joinEndBaseline, openEndPad)
    : Math.max(rootEndPad, openEndPad);

  // Root gets an asymmetric extra pad at its ORIGIN end so the gem has
  // dead space to float over (the cap area doubles as the gem's plaza).
  // Non-root origin ends are FLAT (joining the parent), so they only need
  // joinEndBaseline.
  const gemSizing = GEM_SIZING.get();
  const gemRadiusFrac = gemSizing.RADIUS_AS_STREET_FRAC;
  const gemClearance = gemSizing.BUILDING_CLEARANCE;
  const originPad = !parentStreetWidth
    ? Math.max(endPad, myStreetWidth * (0.5 + gemRadiusFrac) + gemClearance)
    : joinEndBaseline;

  // ---- Sort children alphabetically (files + dirs intermingled) -----------
  const children = (dir.children || [])
    .filter((c) => c.type === NodeKind.File || c.type === NodeKind.Directory)
    .slice()
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  const subOrient = orientation === StreetAxis.X ? StreetAxis.Y : StreetAxis.X;

  // ---- Pre-compute each subdir's local layout in its own local frame ------
  const subLayouts: Record<number, LocalChildLayout> = {};
  for (let i = 0; i < children.length; i++) {
    if (children[i].type === NodeKind.Directory) {
      const localResult = {
        streets: [] as Street[],
        buildings: [] as Building[],
        paths: [] as BuildingPath[],
      };
      _layoutDir(
        children[i] as DirLike,
        0,
        0,
        subOrient,
        localResult,
        myStreetWidth,
        lineStats,
        byteStats
      );
      const bbox = _computeBbox(localResult);
      // The subdir's bbox is in its own local frame (subOrient axis = its main
      // street; the perpendicular axis = "out into branches"). To pack along
      // the PARENT axis, rotate: the parent axis is the perpendicular of
      // subOrient, which corresponds to bbox's X if parent is X-orient or Y
      // if parent is Y-orient. (Same axis convention used by _computeBbox.)
      const alongLow = orientation === StreetAxis.X ? bbox.minX : bbox.minY;
      const alongHigh = orientation === StreetAxis.X ? bbox.maxX : bbox.maxY;
      subLayouts[i] = {
        along: alongHigh - alongLow,
        alongLow,
        rects: _collectRects(localResult),
        streets: localResult.streets,
        buildings: localResult.buildings,
        paths: localResult.paths,
      };
    }
  }

  // ---- Per-side occupancy + monotonic stem-x cursor ----------------------
  const occupancy: Rect[][] = [[], []];
  let priorStemX = originPad;

  for (let ci = 0; ci < children.length; ci++) {
    const child = children[ci];

    // Build the candidate's LOCAL rects (frame: stem at 0, side 1 perp orientation).
    let local: LocalChildLayout;

    if (child.type === NodeKind.File) {
      const dim = getBuildingDimensions(child as FileLike, lineStats, byteStats);
      // along-axis dim = file's "width" (its longer side runs along the street).
      const along = dim.w;
      const perpDepth = dim.d;
      // Local: stem at along=0 (file center on parent axis), perp at parent's halfWidth + pathLen + halfDepth.
      const perpCenter = myStreetWidth / 2 + bldgPathLength + perpDepth / 2;
      // For parent X-orient: parent axis = x, perp = y. For Y-orient: swap.
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
      const buildingRect: Rect = { x: bx, y: by, w: bw, d: bd };
      // Path connects building face → parent street edge.
      let px: number, py: number, pw: number, pd: number;
      if (orientation === StreetAxis.X) {
        px = 0;
        py = myStreetWidth / 2 + bldgPathLength / 2;
        pw = bw * pathWidthFrac;
        pd = bldgPathLength;
      } else {
        px = myStreetWidth / 2 + bldgPathLength / 2;
        py = 0;
        pw = bldgPathLength;
        pd = bd * pathWidthFrac;
      }
      const pathRect: Rect = { x: px, y: py, w: pw, d: pd };
      local = {
        along,
        alongLow: -along / 2,
        rects: [buildingRect, pathRect],
        streets: [],
        buildings: [
          {
            x: bx,
            y: by,
            w: bw,
            d: bd,
            h: dim.h,
            floors: dim.floors,
            file: child as unknown as Building['file'],
            color: null as unknown as string,
            orient: BuildingOrient.North, // placeholder; fixed once side chosen
          },
        ],
        paths: [
          {
            x: px,
            y: py,
            w: pw,
            d: pd,
            file: child as unknown as Building['file'],
          },
        ],
      };
    } else {
      local = subLayouts[ci];
    }

    // Find the leftmost (side, stemX) where translating local.rects fits.
    // The contract is `stem ≥ priorStemX` (alphabetical along-axis order of
    // BRANCH POINTS).  Files on OPPOSITE sides of the same street may share
    // a stem (pairing) — their left-edge back-reach is symmetric, so letting
    // priorStemX stay at the shared stem causes no sibling collision (the
    // opposite side's occupancy is separate) and no parent-street collision
    // (files extend perpendicularly away from the street body).
    //
    // The absolute-floor clamp `originPad + (-local.alongLow)` still applies:
    // it guarantees the FIRST child's near bbox edge never crosses back over
    // the parent's join end (which would clip into the grandparent street).
    // Using `originPad` (not `priorStemX`) as the base means later children
    // are unaffected once `priorStemX ≥ originPad + (-alongLow)`.
    let candidateStemX = Math.max(priorStemX, originPad);
    candidateStemX = Math.max(candidateStemX, originPad + -local.alongLow);

    let chosenSide: 0 | 1 = 0;
    let chosenStemX = 0;
    let placedRects: Rect[] = [];
    const axisAlong: 'x' | 'y' = orientation === StreetAxis.X ? 'x' : 'y';

    // Side preference (best-fit): try both sides at each candidateStemX;
    // pick the smaller stem-x; tiebreak on smaller side area; final
    // tiebreak on side 0. The loop below already tries sidesToTry in order,
    // so we just need the right ORDER for the inner loop's "first-success"
    // semantics. We compute the order once based on side area; ties go to 0.
    const preferredSide: 0 | 1 = _sideArea(occupancy[0]) <= _sideArea(occupancy[1]) ? 0 : 1;

    while (true) {
      const sidesToTry: (0 | 1)[] = preferredSide === 0 ? [0, 1] : [1, 0];
      const fits: { side: 0 | 1; rects: Rect[] }[] = [];
      let smallestAdvance = Infinity;
      for (const side of sidesToTry) {
        const translated = _translateChildRects(
          local.rects,
          originX,
          originY,
          candidateStemX,
          side,
          orientation
        );
        if (!_overlapsAny(translated, occupancy[side])) {
          fits.push({ side, rects: translated });
          continue;
        }
        const advance = _nextEventX(candidateStemX, translated, occupancy[side], axisAlong);
        const delta = advance - candidateStemX;
        if (delta > 0 && delta < smallestAdvance) smallestAdvance = delta;
      }
      if (fits.length > 0) {
        // Both sides may fit at this candidate; preferredSide ordering of
        // sidesToTry already biases the first entry — take it.
        chosenSide = fits[0].side;
        chosenStemX = candidateStemX;
        placedRects = fits[0].rects;
        break;
      }
      if (!isFinite(smallestAdvance) || smallestAdvance <= 0) {
        candidateStemX += childGap;
      } else {
        candidateStemX += smallestAdvance + childGap;
      }
    }

    // Commit the placement.
    occupancy[chosenSide].push(...placedRects);
    priorStemX = chosenStemX;

    if (child.type === NodeKind.File) {
      const negateY = orientation === StreetAxis.X && chosenSide === 0;
      const negateX = orientation === StreetAxis.Y && chosenSide === 0;
      const lb = local.buildings[0];
      const lp = local.paths[0];
      let bx = lb.x,
        by = lb.y;
      if (orientation === StreetAxis.X) {
        bx += chosenStemX;
      } else {
        by += chosenStemX;
      }
      const finalBx = (negateX ? -bx : bx) + originX;
      const finalBy = (negateY ? -by : by) + originY;
      let orient: BuildingOrient;
      if (orientation === StreetAxis.X) {
        orient = chosenSide === 0 ? BuildingOrient.South : BuildingOrient.North;
      } else {
        orient = chosenSide === 0 ? BuildingOrient.East : BuildingOrient.West;
      }
      result.buildings.push({
        x: finalBx,
        y: finalBy,
        w: lb.w,
        d: lb.d,
        h: lb.h,
        floors: lb.floors,
        file: lb.file,
        color: lb.color,
        orient,
      });
      let pxL = lp.x,
        pyL = lp.y;
      if (orientation === StreetAxis.X) {
        pxL += chosenStemX;
      } else {
        pyL += chosenStemX;
      }
      result.paths.push({
        x: (negateX ? -pxL : pxL) + originX,
        y: (negateY ? -pyL : pyL) + originY,
        w: lp.w,
        d: lp.d,
        file: lp.file,
      });
    } else {
      // Subdir: translate streets / buildings / paths from local frame.
      const negateY = orientation === StreetAxis.X && chosenSide === 0;
      const negateX = orientation === StreetAxis.Y && chosenSide === 0;
      const subAnchorX = orientation === StreetAxis.X ? originX + chosenStemX : originX;
      const subAnchorY = orientation === StreetAxis.X ? originY : originY + chosenStemX;
      for (const s of local.streets) {
        result.streets.push({
          x: (negateX ? -s.x : s.x) + subAnchorX,
          y: (negateY ? -s.y : s.y) + subAnchorY,
          length: s.length,
          width: s.width,
          orientation: s.orientation,
          label: s.label,
          dir: s.dir,
        });
      }
      for (const b of local.buildings) {
        result.buildings.push({
          x: (negateX ? -b.x : b.x) + subAnchorX,
          y: (negateY ? -b.y : b.y) + subAnchorY,
          w: b.w,
          d: b.d,
          h: b.h,
          floors: b.floors,
          file: b.file,
          color: b.color,
          orient: _mirrorOrient(b.orient, negateX, negateY) as BuildingOrient,
        });
      }
      for (const p of local.paths) {
        result.paths.push({
          x: (negateX ? -p.x : p.x) + subAnchorX,
          y: (negateY ? -p.y : p.y) + subAnchorY,
          w: p.w,
          d: p.d,
          file: p.file,
        });
      }
    }
  }

  // ---- Compute street length and add street ------------------------------
  let maxAlong = originPad;
  for (const side of [0, 1] as const) {
    for (const r of occupancy[side]) {
      const high =
        orientation === StreetAxis.X ? r.x - originX + r.w / 2 : r.y - originY + r.d / 2;
      if (high > maxAlong) maxAlong = high;
    }
  }
  const streetLength = Math.max(maxAlong + endPad, originPad + endPad);

  let streetCenterX = originX;
  let streetCenterY = originY;
  if (orientation === StreetAxis.X) {
    streetCenterX = originX + streetLength / 2;
  } else {
    streetCenterY = originY + streetLength / 2;
  }

  result.streets.push({
    x: streetCenterX,
    y: streetCenterY,
    length: streetLength,
    width: myStreetWidth,
    orientation,
    label: dir.name || '',
    dir: dir as unknown as Street['dir'],
  });
}

// -----------------------------------------------------------------------------
// _mirrorOrient(orient, negateX, negateY) -> orient
//
// When a subtree's positions are mirrored by the parent's negateX / negateY
// flags, each building's door-facing orient has to flip to match. Otherwise
// the building ends up on the opposite side of its own street with its door
// pointing away.
// -----------------------------------------------------------------------------
function _mirrorOrient(orient: BuildingOrient, negateX: boolean, negateY: boolean): BuildingOrient {
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
// _computeBbox(layout) -> { minX, maxX, minY, maxY }
//
// Computes the axis-aligned bounding box (in world or local coords, depending
// on what the layout is in) covering all streets and buildings.
// -----------------------------------------------------------------------------
function _computeBbox(layout: { streets: Street[]; buildings: Building[] }): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} {
  let minX = Infinity,
    maxX = -Infinity;
  let minY = Infinity,
    maxY = -Infinity;

  for (let i = 0; i < layout.streets.length; i++) {
    const s = layout.streets[i];
    const halfL = s.length / 2;
    const halfW = s.width / 2;
    let x1, x2, y1, y2;
    if (s.orientation === StreetAxis.X) {
      x1 = s.x - halfL;
      x2 = s.x + halfL;
      y1 = s.y - halfW;
      y2 = s.y + halfW;
    } else {
      x1 = s.x - halfW;
      x2 = s.x + halfW;
      y1 = s.y - halfL;
      y2 = s.y + halfL;
    }
    if (x1 < minX) minX = x1;
    if (x2 > maxX) maxX = x2;
    if (y1 < minY) minY = y1;
    if (y2 > maxY) maxY = y2;
  }

  for (let j = 0; j < layout.buildings.length; j++) {
    const b = layout.buildings[j];
    const bx1 = b.x - b.w / 2,
      bx2 = b.x + b.w / 2;
    const by1 = b.y - b.d / 2,
      by2 = b.y + b.d / 2;
    if (bx1 < minX) minX = bx1;
    if (bx2 > maxX) maxX = bx2;
    if (by1 < minY) minY = by1;
    if (by2 > maxY) maxY = by2;
  }

  if (minX === Infinity) {
    return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  }
  return { minX, maxX, minY, maxY };
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

// Internal helpers exposed for tests only. Not part of the public API.
export const __test = { _rectsOverlap, _overlapsAny, _collectRects };
