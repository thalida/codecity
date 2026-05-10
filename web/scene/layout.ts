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
// contour-based packer and overlap invariant checks. (x, y) is the rect's
// CENTER; w/d are the full width/depth (matches Building/Street conventions).
export interface Rect {
  x: number;
  y: number;
  w: number;
  d: number;
}

// LocalChildLayout — what each child contributes to its parent's packing.
//   alongReach: along-axis half-extent that the parent street physically has
//          to cover at the parent boundary (the join strip). For a file:
//          along/2. For a subdir: half its own main-street width.
//   bottomEnvelope, topEnvelope: per-child envelopes in the child's local
//          frame. Used by the parent's _layoutDir to perform a contour-merge
//          instead of rect-vs-rect overlap testing.
//   buildings/streets/paths: typed lists of the child's content, kept for
//          translation back into result arrays once the placement is chosen.
interface LocalChildLayout {
  alongReach: number;
  streets: Street[];
  buildings: Building[];
  paths: BuildingPath[];
  bottomEnvelope: Contour;
  topEnvelope: Contour;
  // v3: mirror metadata. mirrorInvariant=true → orientation choice is a
  // no-op (skip mirror variants). Otherwise mirroredBottom/Top hold the
  // pre-computed mirrored envelopes used by variant evaluation.
  mirrorInvariant: boolean;
  mirroredBottom: Contour;
  mirroredTop: Contour;
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

// RectBuf — a flat Float32Array of [x0, y0, w0, d0, x1, y1, w1, d1, …]
// 4 numbers per rect, length always a multiple of 4. The packer will
// migrate to these in place of Rect[] to avoid per-rect object allocation
// during the per-attempt translation hot path.
export type RectBuf = Float32Array;

// rectCount(buf) -> number of rects in the buffer.
function rectCount(buf: RectBuf): number {
  return buf.length >>> 2;
}

// rectAt(buf, i) -> Rect (allocates a new object — use sparingly, prefer
// buf[i*4 + offset] indexing in hot paths).
function rectAt(buf: RectBuf, i: number): Rect {
  const o = i << 2;
  return { x: buf[o], y: buf[o + 1], w: buf[o + 2], d: buf[o + 3] };
}

// rectsToBuf(rs) -> RectBuf — build a typed-array from an existing Rect[]
// (used by tests and during initial _collectRects-style construction).
function rectsToBuf(rs: Rect[]): RectBuf {
  const buf = new Float32Array(rs.length * 4);
  for (let i = 0; i < rs.length; i++) {
    const r = rs[i];
    const o = i << 2;
    buf[o] = r.x;
    buf[o + 1] = r.y;
    buf[o + 2] = r.w;
    buf[o + 3] = r.d;
  }
  return buf;
}

// bufToRects(buf) -> Rect[] — inverse of rectsToBuf, primarily for tests
// and any caller that prefers the object-based API.
function bufToRects(buf: RectBuf): Rect[] {
  const out: Rect[] = new Array(buf.length >>> 2);
  for (let i = 0; i < out.length; i++) out[i] = rectAt(buf, i);
  return out;
}

// Contour — a sorted list of non-overlapping (perpLow, perpHigh, alongValue)
// segments, stored as a flat Float64Array (4 numbers per segment;
// the 4th slot is reserved for future use). Used by the v2 packer
// in place of per-side rectangle occupancy: each contour is a piecewise-
// constant function `perp → alongValue` recording either the rightmost
// reach (top contour) or leftmost reach (bottom envelope) of placed
// content at each perpendicular depth.
//
// Invariants:
//   - segments are sorted by perpLow
//   - perpHigh_i ≤ perpLow_{i+1} (no overlapping segments)
//   - perpLow < perpHigh for every segment (no degenerate)
//   - "uncovered" perp ranges are implicit (no segment covers them)
export type Contour = { buf: Float64Array; len: number };

// BBox — axis-aligned bbox in {alongMin, alongMax, perpMin, perpMax} form
// expressed in some parent's local frame. Used by v3 placement to score
// candidate placements by max(W, H) of the running parent bbox.
export interface BBox {
  alongMin: number;
  alongMax: number;
  perpMin: number;
  perpMax: number;
}

// _emptyContour() -> a fresh contour with default capacity (32 segments).
// Geometric growth via _growContour as needed.
function _emptyContour(): Contour {
  return { buf: new Float64Array(32 * 4), len: 0 };
}

// _growContour(c, needed) -> grow c's buf to hold at least `needed` segments.
// Doubles capacity until sufficient. No-op if already large enough.
function _growContour(c: Contour, needed: number): void {
  let cap = c.buf.length >>> 2;
  if (cap >= needed) return;
  while (cap < needed) cap *= 2;
  const newBuf = new Float64Array(cap * 4);
  newBuf.set(c.buf.subarray(0, c.len << 2));
  c.buf = newBuf;
}

// _appendSegment(c, perpLow, perpHigh, alongValue)
// Append one segment to the end of c. Caller is responsible for invariants
// (sorted, non-overlapping) — this is a low-level primitive.
// Skips segments where perpLow ≥ perpHigh (degenerate).
function _appendSegment(
  c: Contour,
  perpLow: number,
  perpHigh: number,
  alongValue: number
): void {
  if (perpLow >= perpHigh) return;
  _growContour(c, c.len + 1);
  const o = c.len << 2;
  c.buf[o] = perpLow;
  c.buf[o + 1] = perpHigh;
  c.buf[o + 2] = alongValue;
  c.buf[o + 3] = 0;
  c.len++;
}

// _contourAt(c, perp) -> alongValue at this perp, or -Infinity if no segment
// covers it. Linear scan (typical contour is small; binary search is an
// optimization for later if needed).
function _contourAt(c: Contour, perp: number): number {
  for (let i = 0; i < c.len; i++) {
    const o = i << 2;
    if (c.buf[o] <= perp && perp < c.buf[o + 1]) return c.buf[o + 2];
  }
  return -Infinity;
}

// _envelopesFromRects(rects, alongAxis) -> { bottom, top }
//
// Sweep `rects` along the given axis; at each along position, compute
// min/max perpendicular extent of the active rect set. Returns:
//   bottom: contour over alongAxis values, alongValue = min perpAxis
//   top:    contour over alongAxis values, alongValue = max perpAxis
//
// Note the perp/along terminology in the contour reflects the OUTPUT
// view: the contour's "perp" key is the alongAxis we're sweeping (which
// will become the parent's perp axis when this subtree is placed); the
// contour's "along" value is the perpAxis (which will become the parent's
// along axis).
//
// Time: O(n^2) worst case (inner active set scan); O(n log n) typical
// for non-pathological inputs. For the v2 packer this is called once per
// subtree at the END of its _layoutDir — total work across the recursion
// is O(N) amortised.
function _envelopesFromRects(
  rects: RectBuf,
  alongAxis: 'x' | 'y'
): { bottom: Contour; top: Contour } {
  const n = rects.length >>> 2;
  if (n === 0) return { bottom: _emptyContour(), top: _emptyContour() };

  // Build event list: for each rect, an "enter" and "leave" event in the alongAxis.
  // Each event carries the rect's perpAxis low/high (constant across the rect).
  // Events: [along, isStart (0/1), perpLow, perpHigh].
  // Sort by along ascending, with ENTERS before LEAVES at the same along value
  // (so a zero-width transition doesn't briefly empty the active set).
  const events: number[] = [];
  for (let i = 0; i < n; i++) {
    const o = i << 2;
    const x = rects[o],
      y = rects[o + 1],
      w = rects[o + 2],
      d = rects[o + 3];
    let alongLow: number, alongHigh: number, perpLow: number, perpHigh: number;
    if (alongAxis === 'y') {
      alongLow = y - d / 2;
      alongHigh = y + d / 2;
      perpLow = x - w / 2;
      perpHigh = x + w / 2;
    } else {
      alongLow = x - w / 2;
      alongHigh = x + w / 2;
      perpLow = y - d / 2;
      perpHigh = y + d / 2;
    }
    events.push(alongLow, 1, perpLow, perpHigh, i); // start (5 fields)
    events.push(alongHigh, 0, perpLow, perpHigh, i); // end
  }
  // Sort events by alongValue, then starts before ends at same along.
  // Use index-pair sort because we have flat array.
  const eventCount = events.length / 5;
  const idx = new Array<number>(eventCount);
  for (let i = 0; i < eventCount; i++) idx[i] = i;
  idx.sort((a, b) => {
    const aAlong = events[a * 5],
      bAlong = events[b * 5];
    if (aAlong !== bAlong) return aAlong - bAlong;
    // Same along: starts (1) before ends (0). Reverse: 0 < 1, but we want starts first.
    return events[b * 5 + 1] - events[a * 5 + 1];
  });

  // Sweep, maintaining active rects' perp ranges.
  const active: { perpLow: number; perpHigh: number; id: number }[] = [];
  let lastAlong = -Infinity;
  const bottom = _emptyContour();
  const top = _emptyContour();
  let curMinPerp = +Infinity,
    curMaxPerp = -Infinity;

  for (let i = 0; i < idx.length; i++) {
    const e = idx[i] * 5;
    const along = events[e];
    const isStart = events[e + 1] === 1;
    const perpLow = events[e + 2];
    const perpHigh = events[e + 3];
    const rectId = events[e + 4];

    // Emit segment for [lastAlong, along) using the previous active extents.
    if (active.length > 0 && lastAlong < along) {
      _appendSegment(bottom, lastAlong, along, curMinPerp);
      _appendSegment(top, lastAlong, along, curMaxPerp);
    }

    if (isStart) {
      active.push({ perpLow, perpHigh, id: rectId });
    } else {
      const j = active.findIndex((r) => r.id === rectId);
      if (j >= 0) active.splice(j, 1);
    }
    // Recompute extents after the change.
    curMinPerp = +Infinity;
    curMaxPerp = -Infinity;
    for (let k = 0; k < active.length; k++) {
      if (active[k].perpLow < curMinPerp) curMinPerp = active[k].perpLow;
      if (active[k].perpHigh > curMaxPerp) curMaxPerp = active[k].perpHigh;
    }
    lastAlong = along;
  }

  return { bottom, top };
}



// _collectRectsBuf(layout) -> RectBuf — flat-buffer flavor of _collectRects.
// Used by _layoutDir to capture each subdir's local layout as a single
// Float32Array up front; this buffer is then translated per-attempt into
// the placement loop's scratch buffer.
function _collectRectsBuf(layout: {
  streets?: Street[];
  buildings?: Building[];
  paths?: BuildingPath[];
}): RectBuf {
  const sN = layout.streets ? layout.streets.length : 0;
  const bN = layout.buildings ? layout.buildings.length : 0;
  const pN = layout.paths ? layout.paths.length : 0;
  const buf = new Float32Array((sN + bN + pN) * 4);
  let idx = 0;
  if (layout.streets) {
    for (let i = 0; i < sN; i++) {
      const s = layout.streets[i];
      const o = idx << 2;
      buf[o] = s.x;
      buf[o + 1] = s.y;
      if (s.orientation === StreetAxis.X) {
        buf[o + 2] = s.length;
        buf[o + 3] = s.width;
      } else {
        buf[o + 2] = s.width;
        buf[o + 3] = s.length;
      }
      idx++;
    }
  }
  if (layout.buildings) {
    for (let i = 0; i < bN; i++) {
      const b = layout.buildings[i];
      const o = idx << 2;
      buf[o] = b.x;
      buf[o + 1] = b.y;
      buf[o + 2] = b.w;
      buf[o + 3] = b.d;
      idx++;
    }
  }
  if (layout.paths) {
    for (let i = 0; i < pN; i++) {
      const p = layout.paths[i];
      const o = idx << 2;
      buf[o] = p.x;
      buf[o + 1] = p.y;
      buf[o + 2] = p.w;
      buf[o + 3] = p.d;
      idx++;
    }
  }
  return buf;
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
// Algorithm (v2 — contour-based):
//   1. Sort all children (files + subdirs) alphabetically by name.
//   2. Pre-compute each subdir's layout in its own local frame; derive
//      perpendicular envelopes (bottom + top contours) for each child.
//   3. Walk children in order, assigning each to a side (primary/secondary)
//      and sliding it along the street until it clears the side's running
//      contour. After placement, merge the child's contour into the side's:
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
  byteStats: RangeStat,
  parentStemXInGrandparent?: number,
  depth: number = 0
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
        byteStats,
        undefined, // stemX in grandparent unknown during pre-compute
        depth + 1
      );
      // Subdir's join with parent is a T-intersection of width = subdir's own
      // main-street width. The parent only needs pavement up to half that
      // width past the stem; the subdir's far branches extend in PERP
      // directions (or non-zero perp depths), not in the parent's along axis
      // at the parent boundary.
      const subStreetWidth = _streetWidthForDir(children[i] as DirLike);
      const localRects = _collectRectsBuf(localResult);
      // The subdir's "along" axis (its main street direction) becomes the
      // PARENT's PERP axis when the subdir is placed. So when we sweep the
      // subdir's rects to derive its envelopes, we sweep along the subdir's
      // own along axis. For Y-orient subdir (subOrient === Y): alongAxis = 'y'.
      const subdirAlongAxis: 'x' | 'y' = subOrient === StreetAxis.X ? 'x' : 'y';
      const { bottom: bottomEnv, top: topEnv } = _envelopesFromRects(
        localRects,
        subdirAlongAxis
      );
      const subMirrorInvariant = _isMirrorInvariant(bottomEnv, topEnv);
      const subMirror = subMirrorInvariant
        ? { bottom: bottomEnv, top: topEnv }
        : _mirrorEnvelopes(bottomEnv, topEnv);
      subLayouts[i] = {
        alongReach: subStreetWidth / 2,
        streets: localResult.streets,
        buildings: localResult.buildings,
        paths: localResult.paths,
        bottomEnvelope: bottomEnv,
        topEnvelope: topEnv,
        mirrorInvariant: subMirrorInvariant,
        mirroredBottom: subMirror.bottom,
        mirroredTop: subMirror.top,
      };
    }
  }

  // ---- Per-side top contours + monotonic stem-x cursor (v2 packer) -------
  // Two Contours per side — one for the bottom envelope (reads only) and
  // one for the top contour (in-place merge). Each placement is a single
  // _slideUntilClear merge against the side's top contour. Pre-seed each
  // side at non-root with a phantom block representing the grandparent's
  // street body so children's back-extending content is rejected per-perp-
  // depth without the coarse `originPad + (-alongLow)` clamp.
  const sideContour: [Contour, Contour] = [_emptyContour(), _emptyContour()];
  if (parentStreetWidth !== undefined) {
    // Asymmetric pre-seed (B). Side 0 is the gem-facing side: in parent's
    // local frame, content at perp = X corresponds to web_local_x = -X (i.e.
    // negative direction in the grandparent's along axis). At perp >
    // parentStemXInGrandparent the world-x falls behind the grandparent's
    // gem — empty space, no constraint needed. So tighten side 0's pre-seed
    // perp range to parentStemXInGrandparent when known. Side 1 is the
    // far-from-gem side: we don't know the grandparent's far-end length
    // here, so keep the conservative PRESEED_PERP_INF.
    _preseedGrandparentBlock(sideContour[0], parentStreetWidth, parentStemXInGrandparent);
    _preseedGrandparentBlock(sideContour[1], parentStreetWidth, undefined);
  }
  let priorStemX = originPad;
  // maxBoundaryAlong — running max of (chosenStemX + child.alongReach), which
  // is the along-axis extent the parent street physically has to cover at the
  // parent boundary. Tracked incrementally so we don't re-iterate every rect
  // in occupancy at the end (and so far branches of subtree children that
  // extend in the parent's along-axis direction at non-zero perp depth do NOT
  // inflate the parent street's length — they extend perpendicular to the
  // parent and don't require parent-street pavement).
  let maxBoundaryAlong = originPad;

  // __DEBUG_LAYOUT__: at root depth, capture each child's pre-loop rect counts
  // so we can compute its actual placed bbox and compare against the envelope-
  // predicted bbox (via _candidateBboxInParent). Off unless globalThis.
  // __DEBUG_LAYOUT__ is truthy. Logs only the predicted-vs-actual mismatch.
  const _dbgEnabled =
    depth === 0 &&
    typeof globalThis !== 'undefined' &&
    Boolean((globalThis as { __DEBUG_LAYOUT__?: unknown }).__DEBUG_LAYOUT__);

  for (let ci = 0; ci < children.length; ci++) {
    const child = children[ci];

    const _dbgStartStreets = _dbgEnabled ? result.streets.length : 0;
    const _dbgStartBuildings = _dbgEnabled ? result.buildings.length : 0;
    const _dbgStartPaths = _dbgEnabled ? result.paths.length : 0;

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
      // Pack the file's two rects (building + path) directly into a
      // Float32Array of length 8 — avoids constructing two interim Rect
      // objects per file (one per child, ~10k allocations on d4f10).
      const fileRectsBuf = new Float32Array(8);
      fileRectsBuf[0] = bx;
      fileRectsBuf[1] = by;
      fileRectsBuf[2] = bw;
      fileRectsBuf[3] = bd;
      fileRectsBuf[4] = px;
      fileRectsBuf[5] = py;
      fileRectsBuf[6] = pw;
      fileRectsBuf[7] = pd;
      // For a file child: derive envelopes directly from the building+path
      // geometry. The file's "along" axis from the parent's perspective is
      // the parent's perp axis. We sweep the file's rects on the parent's
      // perp axis to get the envelope.
      // For X-orient parent: parent's perp = y, so sweep on 'y'.
      // For Y-orient parent: parent's perp = x, so sweep on 'x'.
      const fileEnvSweepAxis: 'x' | 'y' = orientation === StreetAxis.X ? 'y' : 'x';
      const { bottom: fileBottom, top: fileTop } = _envelopesFromRects(
        fileRectsBuf,
        fileEnvSweepAxis
      );
      const fileMirrorInvariant = _isMirrorInvariant(fileBottom, fileTop);
      const fileMirror = fileMirrorInvariant
        ? { bottom: fileBottom, top: fileTop }
        : _mirrorEnvelopes(fileBottom, fileTop);
      local = {
        // File's footprint at the parent boundary spans `along` along the
        // parent's axis (centered on the stem).
        alongReach: along / 2,
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
        bottomEnvelope: fileBottom,
        topEnvelope: fileTop,
        mirrorInvariant: fileMirrorInvariant,
        mirroredBottom: fileMirror.bottom,
        mirroredTop: fileMirror.top,
      };
    } else {
      local = subLayouts[ci];
    }

    // v2 placement: per-side top contour merge.
    //
    // For each side, _slideUntilClear computes the smallest along-axis
    // offset such that the child's bottom envelope at every perp depth sits
    // at least `childGap` ahead of the side's top contour. Combined with the
    // alphabetical-monotonic constraint (stem ≥ priorStemX) and the parent's
    // origin pad, this yields the candidate stem-x for each side.
    //
    // _preseedGrandparentBlock seeds each side's contour with a phantom
    // segment representing the grandparent's main street body's right edge
    // in the parent's local along axis (= +gW/2). The perp range is
    // over-approximated to PRESEED_PERP_INF (uniformly applied across all
    // reasonable perp depths) — a child's envelope is forced past the
    // grandparent's body at every perp, replacing v1's coarse
    // `originPad + (-alongLow)` along-axis clamp with a contour-merge
    // constraint. The over-approximation is intentional: a tighter perp
    // bound would require threading the grandparent's actual length through
    // the recursion, and the practical perp depth of any subtree is several
    // orders of magnitude below 1e9, so the over-constraint is harmless.
    //
    // v3 variant evaluation: for each (side ∈ {0, 1}) × (mirrored ∈ {natural,
    // mirrored}), compute slide-until-clear stemX, then score = stemX.
    // Pick variant with smallest score → smallest contribution to parent
    // road length.
    //
    // Mirror variants are skipped when local.mirrorInvariant is true
    // (files, symmetric subtrees) — they would yield identical candidates.
    //
    // Tiebreaks (deterministic): smaller score → side 0 → natural over
    // mirrored → smaller stemX (last is moot when score == cand, but
    // kept for safety against future score changes).
    let chosenSide: 0 | 1 = 0;
    let chosenMirrored = false;
    let chosenStemX = Infinity;
    let chosenScore = Infinity;

    // __DEBUG_LAYOUT_LABEL__: when this child's name matches the label, route
    // every tryVariant's _slideUntilClear call through the verbose logger.
    const _dbgLabel =
      depth === 0 && typeof globalThis !== 'undefined'
        ? ((globalThis as { __DEBUG_LAYOUT_LABEL__?: unknown })
            .__DEBUG_LAYOUT_LABEL__ as string | undefined)
        : undefined;
    const _childName =
      child.type === NodeKind.File
        ? (child as FileLike).name
        : (child as DirLike).name;
    const _childMatchesDbg = depth === 0 && _dbgLabel === _childName;
    if (_childMatchesDbg) {
      // eslint-disable-next-line no-console
      console.log(
        `[slide-debug] child="${_childName}" mirrorInvariant=${local.mirrorInvariant} ` +
          `priorStemX=${priorStemX.toFixed(2)} originPad=${originPad.toFixed(2)} ` +
          `childGap=${childGap}\n` +
          `  natural bot ${_contourSummary(local.bottomEnvelope)}\n` +
          `  natural top ${_contourSummary(local.topEnvelope)}\n` +
          `  mirror  bot ${_contourSummary(local.mirroredBottom)}\n` +
          `  mirror  top ${_contourSummary(local.mirroredTop)}\n` +
          `  side[0]     ${_contourSummary(sideContour[0])}\n` +
          `  side[1]     ${_contourSummary(sideContour[1])}`
      );
      // Per-segment dump in the suspect perp window. Defaults to [380, 420]
      // (around web/scene's perp depth where the slide undersells); override
      // via globalThis.__DEBUG_LAYOUT_PERP_LO__ / __DEBUG_LAYOUT_PERP_HI__.
      const _g = globalThis as {
        __DEBUG_LAYOUT_PERP_LO__?: unknown;
        __DEBUG_LAYOUT_PERP_HI__?: unknown;
      };
      const _perpLo = typeof _g.__DEBUG_LAYOUT_PERP_LO__ === 'number' ? _g.__DEBUG_LAYOUT_PERP_LO__ : 380;
      const _perpHi = typeof _g.__DEBUG_LAYOUT_PERP_HI__ === 'number' ? _g.__DEBUG_LAYOUT_PERP_HI__ : 420;
      _dumpContourWindow(local.mirroredBottom, `${_childName}.mirroredBottom`, _perpLo, _perpHi);
      _dumpContourWindow(local.bottomEnvelope, `${_childName}.naturalBottom`, _perpLo, _perpHi);
      _dumpContourWindow(local.topEnvelope, `${_childName}.naturalTop`, _perpLo, _perpHi);
      _dumpContourWindow(sideContour[0], 'sideContour[0]', _perpLo, _perpHi);
      _dumpContourWindow(sideContour[1], 'sideContour[1]', _perpLo, _perpHi);
    }

    const tryVariant = (s: 0 | 1, m: boolean): void => {
      _dbgSlideCtx = _childMatchesDbg
        ? { label: _childName, tag: `side=${s} mirror=${m}` }
        : null;
      const bot = m ? local.mirroredBottom : local.bottomEnvelope;
      const off = _slideUntilClear(bot, sideContour[s], childGap);
      _dbgSlideCtx = null;
      const cand = Math.max(priorStemX, originPad, off);
      // Score = cand stemX. Smaller cand = parent road extends less to
      // cover this child = shorter parent road. The variant (side, mirror)
      // that fits with the smallest cand wins. Perp extent is irrelevant
      // — long-rectangle worlds with short roads beat square worlds with
      // long roads.
      const score = cand;
      // Tiebreak chain: score < (strict beat); else if score equal,
      // prefer (side 0 over side 1), else prefer (natural over mirrored),
      // else prefer smaller stemX.
      let better = false;
      if (score < chosenScore - OVERLAP_EPS) better = true;
      else if (Math.abs(score - chosenScore) <= OVERLAP_EPS) {
        if (s < chosenSide) better = true;
        else if (s === chosenSide) {
          if (!m && chosenMirrored) better = true;
          else if (m === chosenMirrored && cand < chosenStemX) better = true;
        }
      }
      if (better) {
        chosenSide = s;
        chosenMirrored = m;
        chosenStemX = cand;
        chosenScore = score;
      }
    };
    tryVariant(0, false);
    tryVariant(1, false);
    if (!local.mirrorInvariant) {
      tryVariant(0, true);
      tryVariant(1, true);
    }
    // B (asymmetric pre-seed via two-pass): for subdir children of the ROOT,
    // re-run _layoutDir now that chosenStemX is known. The child's own pre-
    // seed for its non-root recursion can use the asymmetric form (gem-facing
    // side tightened to chosenStemX), allowing back-extending content to
    // settle in world-empty space behind the root's gem instead of pushing
    // the root's road longer. The re-computed envelope updates the side
    // contour, so later siblings benefit from the tighter packing.
    //
    // Scoped to depth === 0 (root). Re-computing at every depth would
    // cascade: each re-compute would itself trigger re-computes of its
    // own children, doubling work per level. At root only, total work is
    // bounded to ~2× the first pass on root's subdir children.
    //
    // Guard: the re-compute can sometimes pick a DIFFERENT chosenSide for
    // the child's own subchildren (because the tighter pre-seed shifts the
    // per-side slide-until-clear results). When that happens, the child's
    // content can flip to the opposite local-perp side, producing a
    // topEnvelope with LARGER max-along than the pre-compute had — which
    // would push subsequent siblings further out and LENGTHEN the parent
    // street, the opposite of B's intent. So we only adopt the re-compute
    // when its topEnvelope is no worse than the pre-compute's.
    if (child.type !== NodeKind.File && depth === 0) {
      const reLocalResult = {
        streets: [] as Street[],
        buildings: [] as Building[],
        paths: [] as BuildingPath[],
      };
      _layoutDir(
        child as DirLike,
        0,
        0,
        subOrient,
        reLocalResult,
        myStreetWidth,
        lineStats,
        byteStats,
        chosenStemX, // now known — feeds asymmetric pre-seed
        1 // depth-1 child of root
      );
      const reLocalRects = _collectRectsBuf(reLocalResult);
      const reSubdirAlongAxis: 'x' | 'y' = subOrient === StreetAxis.X ? 'x' : 'y';
      const { bottom: reBottomEnv, top: reTopEnv } = _envelopesFromRects(
        reLocalRects,
        reSubdirAlongAxis
      );
      // Compare the two top-envelopes by their max along value — that's
      // the dominant factor in how far the side contour gets pushed when
      // we merge below. If RE is no worse than PRE, adopt RE. Otherwise,
      // discard the re-compute and keep PRE (correctness-safe since PRE's
      // rects + envelopes are internally consistent).
      const reMirrorInvariant = _isMirrorInvariant(reBottomEnv, reTopEnv);
      const reMirror = reMirrorInvariant
        ? { bottom: reBottomEnv, top: reTopEnv }
        : _mirrorEnvelopes(reBottomEnv, reTopEnv);
      // The merged envelope is the chosen-orientation's top contour.
      // Compare what would actually be committed in each case so the
      // guard's "no worse" criterion matches the merge step's behavior.
      const preMergeTop = chosenMirrored ? local.mirroredTop : local.topEnvelope;
      const reMergeTop = chosenMirrored ? reMirror.top : reTopEnv;
      const preMergeMaxAlong = _maxAlongValue(preMergeTop);
      const reMergeMaxAlong = _maxAlongValue(reMergeTop);

      // Second guard: re-run _slideUntilClear with RE's chosen-variant bot
      // envelope. The committed chosenStemX was derived against pass-1's
      // bot envelope; if RE shifts content per-perp such that the same
      // slide would now require a larger stemX, adopting RE invalidates
      // the slide invariant and produces cross-subtree overlaps. The
      // mergeMaxAlong-only check (above) doesn't catch this: per-perp
      // shifts can occur while the global max-along stays unchanged.
      const reChosenBot = chosenMirrored ? reMirror.bottom : reBottomEnv;
      const reSlideOff = _slideUntilClear(reChosenBot, sideContour[chosenSide], childGap);
      const reCand = Math.max(priorStemX, originPad, reSlideOff);
      const reSlideStillSatisfied = reCand <= chosenStemX + OVERLAP_EPS;

      if (reMergeMaxAlong <= preMergeMaxAlong && reSlideStillSatisfied) {
        local = {
          alongReach: local.alongReach,
          streets: reLocalResult.streets,
          buildings: reLocalResult.buildings,
          paths: reLocalResult.paths,
          bottomEnvelope: reBottomEnv,
          topEnvelope: reTopEnv,
          mirrorInvariant: reMirrorInvariant,
          mirroredBottom: reMirror.bottom,
          mirroredTop: reMirror.top,
        };
      }
    }

    // Commit: merge the child's top envelope (shifted by chosenStemX) into
    // the chosen side's top contour.
    // Commit the chosen orientation's top envelope into the side contour.
    // For mirrored: the mirrored_top contour already has negated
    // alongValues, so adding chosenStemX yields the correct
    // post-translation parent-along extent.
    const mergeTop = chosenMirrored ? local.mirroredTop : local.topEnvelope;
    _mergeTopContour(sideContour[chosenSide], mergeTop, chosenStemX);
    priorStemX = chosenStemX;
    const boundaryHigh = chosenStemX + local.alongReach;
    if (boundaryHigh > maxBoundaryAlong) maxBoundaryAlong = boundaryHigh;

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
      // Two independent reflections applied:
      //   - chosenSide=0 negates the parent's perp axis (subtree's along).
      //   - chosenMirrored negates the subtree's perp axis (parent's along).
      // For X-orient parent: side 0 → negateY; mirror → negateXSub (subtree-
      // local x is the subtree's perp axis).
      // For Y-orient parent: side 0 → negateX; mirror → negateYSub.
      const negateY = orientation === StreetAxis.X && chosenSide === 0;
      const negateX = orientation === StreetAxis.Y && chosenSide === 0;
      const negateXSub = orientation === StreetAxis.X && chosenMirrored;
      const negateYSub = orientation === StreetAxis.Y && chosenMirrored;
      const flipX = negateX || negateXSub;
      const flipY = negateY || negateYSub;
      const subAnchorX = orientation === StreetAxis.X ? originX + chosenStemX : originX;
      const subAnchorY = orientation === StreetAxis.X ? originY : originY + chosenStemX;
      for (const s of local.streets) {
        result.streets.push({
          x: (flipX ? -s.x : s.x) + subAnchorX,
          y: (flipY ? -s.y : s.y) + subAnchorY,
          length: s.length,
          width: s.width,
          orientation: s.orientation,
          label: s.label,
          dir: s.dir,
        });
      }
      for (const b of local.buildings) {
        result.buildings.push({
          x: (flipX ? -b.x : b.x) + subAnchorX,
          y: (flipY ? -b.y : b.y) + subAnchorY,
          w: b.w,
          d: b.d,
          h: b.h,
          floors: b.floors,
          file: b.file,
          color: b.color,
          orient: _mirrorOrient(b.orient, flipX, flipY) as BuildingOrient,
        });
      }
      for (const p of local.paths) {
        result.paths.push({
          x: (flipX ? -p.x : p.x) + subAnchorX,
          y: (flipY ? -p.y : p.y) + subAnchorY,
          w: p.w,
          d: p.d,
          file: p.file,
        });
      }
    }

    // __DEBUG_LAYOUT__: predicted-vs-actual bbox check (root depth only).
    if (_dbgEnabled) {
      const childLabel =
        child.type === NodeKind.File
          ? (child as FileLike).name
          : (child as DirLike).name;
      const predicted = _candidateBboxInParent(
        local.bottomEnvelope,
        local.topEnvelope,
        chosenStemX,
        chosenSide,
        chosenMirrored
      );
      // Compute actual world bbox of the rects this iteration appended.
      let aMinX = Infinity,
        aMaxX = -Infinity,
        aMinY = Infinity,
        aMaxY = -Infinity;
      const _acc = (rx: number, ry: number, rw: number, rd: number): void => {
        const x1 = rx - rw / 2,
          x2 = rx + rw / 2,
          y1 = ry - rd / 2,
          y2 = ry + rd / 2;
        if (x1 < aMinX) aMinX = x1;
        if (x2 > aMaxX) aMaxX = x2;
        if (y1 < aMinY) aMinY = y1;
        if (y2 > aMaxY) aMaxY = y2;
      };
      for (let i = _dbgStartStreets; i < result.streets.length; i++) {
        const s = result.streets[i];
        if (s.orientation === StreetAxis.X) _acc(s.x, s.y, s.length, s.width);
        else _acc(s.x, s.y, s.width, s.length);
      }
      for (let i = _dbgStartBuildings; i < result.buildings.length; i++) {
        const b = result.buildings[i];
        _acc(b.x, b.y, b.w, b.d);
      }
      for (let i = _dbgStartPaths; i < result.paths.length; i++) {
        const p = result.paths[i];
        _acc(p.x, p.y, p.w, p.d);
      }
      // For X-orient root: along=x, perp=y. For Y-orient root: along=y, perp=x.
      // Root is X-orient (see layoutCity), but be general for safety.
      const predX1 =
        orientation === StreetAxis.X ? predicted.alongMin : predicted.perpMin;
      const predX2 =
        orientation === StreetAxis.X ? predicted.alongMax : predicted.perpMax;
      const predY1 =
        orientation === StreetAxis.X ? predicted.perpMin : predicted.alongMin;
      const predY2 =
        orientation === StreetAxis.X ? predicted.perpMax : predicted.alongMax;
      const dMinX = aMinX - predX1,
        dMaxX = aMaxX - predX2,
        dMinY = aMinY - predY1,
        dMaxY = aMaxY - predY2;
      // Mismatch = actual extends outside predicted bbox by more than EPS.
      const EPS = 1e-3;
      const mismatch =
        dMinX < -EPS || dMaxX > EPS || dMinY < -EPS || dMaxY > EPS;
      // eslint-disable-next-line no-console
      console.log(
        `[layout-debug]${mismatch ? ' MISMATCH' : ''} child="${childLabel}" type=${child.type} ` +
          `side=${chosenSide} mirror=${chosenMirrored} stemX=${chosenStemX.toFixed(2)}\n` +
          `  predicted x=[${predX1.toFixed(2)}, ${predX2.toFixed(2)}] ` +
          `y=[${predY1.toFixed(2)}, ${predY2.toFixed(2)}]\n` +
          `  actual    x=[${aMinX.toFixed(2)}, ${aMaxX.toFixed(2)}] ` +
          `y=[${aMinY.toFixed(2)}, ${aMaxY.toFixed(2)}]\n` +
          `  delta minX=${dMinX.toFixed(2)} maxX=${dMaxX.toFixed(2)} ` +
          `minY=${dMinY.toFixed(2)} maxY=${dMaxY.toFixed(2)}`
      );
    }
  }

  // ---- Compute street length and add street ------------------------------
  // The parent street physically only needs to reach where children branch
  // off (their stem) plus a small along-axis clearance for that branch's
  // own footprint at the parent boundary — `maxBoundaryAlong` tracks exactly
  // that. Subtree contents past the stem extend perpendicular to the parent
  // and don't require parent-street pavement, so we do NOT use placed rect
  // extents for length here (which would incorrectly include far branches of
  // subtree children that extend in the parent's along-axis direction at
  // non-zero perp depth).
  const streetLength = Math.max(maxBoundaryAlong + endPad, originPad + endPad);

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

// __DEBUG_LAYOUT_LABEL__ context: when set to a child's name (file/dir) by
// _layoutDir at root depth, _slideUntilClear logs its inputs (contour
// summaries) and the dominant (perp, sAlong, cAlong) triple that drove
// maxOffset. Module-scoped so we don't have to thread a debug arg through
// every call site. Reset to null after each child's variant loop.
let _dbgSlideCtx: { label: string; tag: string } | null = null;

function _contourSummary(c: Contour): string {
  if (c.len === 0) return '<empty>';
  let perpMin = Infinity,
    perpMax = -Infinity,
    alongMin = Infinity,
    alongMax = -Infinity;
  for (let i = 0; i < c.len; i++) {
    const o = i << 2;
    if (c.buf[o] < perpMin) perpMin = c.buf[o];
    if (c.buf[o + 1] > perpMax) perpMax = c.buf[o + 1];
    if (c.buf[o + 2] < alongMin) alongMin = c.buf[o + 2];
    if (c.buf[o + 2] > alongMax) alongMax = c.buf[o + 2];
  }
  return (
    `len=${c.len} perp=[${perpMin.toFixed(2)}, ${perpMax.toFixed(2)}] ` +
    `along=[${alongMin.toFixed(2)}, ${alongMax.toFixed(2)}]`
  );
}

// _dumpContourWindow(c, label, perpLo, perpHi) — list every segment whose
// perp range overlaps [perpLo, perpHi]. Used by the slide diagnostic to
// inspect contour content at the specific perp where a constraint is
// suspected. Limits to 50 segments to keep output bounded.
function _dumpContourWindow(c: Contour, label: string, perpLo: number, perpHi: number): void {
  const lines: string[] = [];
  let count = 0;
  for (let i = 0; i < c.len; i++) {
    const o = i << 2;
    const pLo = c.buf[o],
      pHi = c.buf[o + 1],
      a = c.buf[o + 2];
    if (pHi <= perpLo) continue;
    if (pLo >= perpHi) break; // contour sorted by perp
    if (count++ >= 50) {
      lines.push('  ... (truncated, more segments in window)');
      break;
    }
    lines.push(`  [${pLo.toFixed(3)}, ${pHi.toFixed(3)}] along=${a.toFixed(3)}`);
  }
  // eslint-disable-next-line no-console
  console.log(
    `[contour-window] ${label} in perp [${perpLo}, ${perpHi}] (${count} segs):\n` +
      (lines.length === 0 ? '  <none>' : lines.join('\n'))
  );
}

// _slideUntilClear(childBot, sideTop, gap) -> offset
//
// Returns the smallest along-axis offset such that for every perp-depth
// where both contours are defined, childBot(perp) + offset ≥ sideTop(perp) + gap.
// If contours don't overlap at any perp, returns -Infinity (no constraint).
//
// Time: O(childBot.len + sideTop.len) — single linear merge of sorted segments.
function _slideUntilClear(childBot: Contour, sideTop: Contour, gap: number): number {
  let maxOffset = -Infinity;
  let _dbgPerp = NaN,
    _dbgS = NaN,
    _dbgC = NaN;
  let i = 0,
    j = 0;
  while (i < childBot.len && j < sideTop.len) {
    const cLow = childBot.buf[i << 2],
      cHigh = childBot.buf[(i << 2) + 1],
      cAlong = childBot.buf[(i << 2) + 2];
    const sLow = sideTop.buf[j << 2],
      sHigh = sideTop.buf[(j << 2) + 1],
      sAlong = sideTop.buf[(j << 2) + 2];
    const lo = Math.max(cLow, sLow),
      hi = Math.min(cHigh, sHigh);
    if (lo < hi) {
      // Overlap exists. Required offset to clear:
      //   child's left edge + offset ≥ side's right edge + gap
      //   offset ≥ sAlong + gap - cAlong
      const off = sAlong + gap - cAlong;
      if (off > maxOffset) {
        maxOffset = off;
        if (_dbgSlideCtx !== null) {
          _dbgPerp = (lo + hi) / 2;
          _dbgS = sAlong;
          _dbgC = cAlong;
        }
      }
    }
    // Advance whichever segment ends first.
    if (cHigh <= sHigh) i++;
    else j++;
  }
  if (_dbgSlideCtx !== null) {
    const { label, tag } = _dbgSlideCtx;
    // eslint-disable-next-line no-console
    console.log(
      `[slide] "${label}" ${tag} gap=${gap}\n` +
        `  childBot ${_contourSummary(childBot)}\n` +
        `  sideTop  ${_contourSummary(sideTop)}\n` +
        `  → off=${maxOffset === -Infinity ? '-Inf' : maxOffset.toFixed(3)}` +
        (maxOffset > -Infinity
          ? ` dominant: perp~${_dbgPerp.toFixed(2)} sAlong=${_dbgS.toFixed(2)} cAlong=${_dbgC.toFixed(2)}`
          : '')
    );
  }
  return maxOffset;
}

// _mergeTopContour(sideTop, childTop, offset) -> void
//
// Overlay childTop (shifted by `offset` in along-axis) into sideTop in place.
// At each perp position covered by either contour, sideTop's new alongValue
// is max(its prior value, childTop's value + offset).
//
// Implementation: sweep both contours' breakpoints in parallel, build the
// merged segment list, then copy back into sideTop.
//
// Time: O(sideTop.len + childTop.len).
// TODO(perf): _mergeTopContour allocates fresh `events`, `idx`, and `out` JS
// arrays per call. For the typical bench case this is sub-millisecond and
// not the bottleneck. If profiling later shows GC pressure, pool a per-
// _layoutDir scratch buffer here.
function _mergeTopContour(sideTop: Contour, childTop: Contour, offset: number): void {
  // Collect ordered breakpoints from both contours.
  // Each contour contributes 2 events per segment (start, end).
  // Sort by perp; at same perp, ends before starts.
  const sN = sideTop.len,
    cN = childTop.len;
  if (cN === 0) return; // nothing to add

  // Event kinds. Numerically: ends < starts so the sort puts ends-before-starts
  // at the same perp. Each event triple is [perp, kind, alongValue].
  const K_SIDE_END = 0;
  const K_CHILD_END = 1;
  const K_SIDE_START = 2;
  const K_CHILD_START = 3;

  const events: number[] = []; // flat array: [perp, kind, value]
  for (let i = 0; i < sN; i++) {
    events.push(sideTop.buf[i << 2], K_SIDE_START, sideTop.buf[(i << 2) + 2]);
    events.push(sideTop.buf[(i << 2) + 1], K_SIDE_END, sideTop.buf[(i << 2) + 2]);
  }
  for (let i = 0; i < cN; i++) {
    events.push(childTop.buf[i << 2], K_CHILD_START, childTop.buf[(i << 2) + 2] + offset);
    events.push(childTop.buf[(i << 2) + 1], K_CHILD_END, childTop.buf[(i << 2) + 2] + offset);
  }
  const evCount = events.length / 3;
  const idx: number[] = new Array(evCount);
  for (let i = 0; i < evCount; i++) idx[i] = i;
  idx.sort((a, b) => {
    const aPerp = events[a * 3],
      bPerp = events[b * 3];
    if (aPerp !== bPerp) return aPerp - bPerp;
    // Same perp: ends (kind 0,1) before starts (kind 2,3).
    return events[a * 3 + 1] - events[b * 3 + 1];
  });

  // Sweep, tracking current side and child values.
  let curS = -Infinity,
    curC = -Infinity;
  let lastPerp = NaN;
  // Build merged into a scratch list (we can't write into sideTop directly
  // because we're still reading from it).
  const out: number[] = []; // flat: [perpLow, perpHigh, alongValue]

  for (let k = 0; k < idx.length; k++) {
    const e = idx[k] * 3;
    const perp = events[e];
    if (!isNaN(lastPerp) && perp > lastPerp) {
      const cur = Math.max(curS, curC);
      if (cur > -Infinity) {
        // Coalesce with previous output segment if same value AND adjacent.
        const oN = out.length;
        if (oN >= 3 && out[oN - 1] === cur && out[oN - 2] === lastPerp) {
          out[oN - 2] = perp;
        } else {
          out.push(lastPerp, perp, cur);
        }
      }
    }
    const kind = events[e + 1];
    const val = events[e + 2];
    if (kind === K_SIDE_START) curS = val;
    else if (kind === K_SIDE_END) curS = -Infinity;
    else if (kind === K_CHILD_START) curC = val;
    else if (kind === K_CHILD_END) curC = -Infinity;
    lastPerp = perp;
  }

  // Copy out into sideTop.
  sideTop.len = 0;
  _growContour(sideTop, out.length / 3);
  for (let i = 0; i < out.length; i += 3) {
    _appendSegment(sideTop, out[i], out[i + 1], out[i + 2]);
  }
}

// _preseedGrandparentBlock(side, grandparentStreetWidth)
//
// Seed a non-root parent's side contour with a phantom segment representing
// the grandparent's street body in the parent's local frame on the contour's
// side. The grandparent's main street is perpendicular to the parent and
// crosses through the parent's centerline (T-intersection). In parent's
// local frame:
//   - the grandparent's body extends in parent's PERP axis (= positive
//     contour perp) from 0 outward — its main street runs along this
//     direction, far past the parent's join. We use a very generous upper
//     bound (PRESEED_PERP_INF) to cover any reasonable child's perp extent;
//     children whose content extends past the actual grandparent length are
//     a rare pathological case where over-constraint is harmless.
//   - the grandparent's body extends in parent's ALONG axis from -gW/2 to
//     +gW/2 (its WIDTH centered on world Y=0 = parent's local along=0).
//
// The relevant constraint for a child of the parent: at any perp where the
// grandparent body reaches, the child's leftmost along edge (alongValue in
// the child's bottom envelope) must clear +gW/2 (the high along edge of the
// grandparent's body). _slideUntilClear adds the gap parameter on top.
//
// This replaces v1's coarse `originPad + (-alongLow)` clamp with a per-
// perp-depth constraint: a child whose content extends back (alongLow < 0)
// at depths within the grandparent's reach gets pushed forward; content at
// depths past the grandparent (perp > grandparent half-length) is free to
// extend back without penalty in PRINCIPLE, but the practical bound makes
// no distinction here.
//
// Practical over-approximation. Real-world subtree perp extents are bounded
// by max-tree-depth × max-street-width (≈O(1000)); 1e9 is 6 orders of
// magnitude larger. Threading the actual grandparent length through the
// recursion would give a tighter bound but isn't needed for correctness.
const PRESEED_PERP_INF = 1e9;
function _preseedGrandparentBlock(
  side: Contour,
  grandparentStreetWidth: number,
  perpRange?: number
): void {
  const gW2 = grandparentStreetWidth / 2;
  if (gW2 <= 0) return;
  // perpRange overrides the default PRESEED_PERP_INF when caller knows a
  // tighter bound (B's asymmetric pre-seed: gem-facing side uses parent's
  // stemX in grandparent — past that perp, world space behind the gem is
  // empty and no constraint is needed). Falls back to PRESEED_PERP_INF when
  // undefined or non-positive.
  const perpHigh = perpRange !== undefined && perpRange > 0 ? perpRange : PRESEED_PERP_INF;
  _appendSegment(side, 0, perpHigh, gW2);
}

// _envelopePerpMin(c) -> number
//
// Minimum perpLow value across all segments in c. For an empty contour,
// returns +Infinity. Used by candidate bbox computation to find a
// subtree's lowest perp extent (= parent's perp axis lower bound).
function _envelopePerpMin(c: Contour): number {
  let min = Infinity;
  for (let i = 0; i < c.len; i++) {
    const pl = c.buf[i << 2];
    if (pl < min) min = pl;
  }
  return min;
}

// _maxPerpReach(c) -> number
//
// Maximum perpHigh value across all segments in c. For an empty contour,
// returns 0. Used by side selection to identify which side already extends
// farther in perp depth, so we can prefer placing the next big child on
// the same side (keeps small content on the side with available perp
// headroom and keeps growth concentrated on the side that's already grown).
function _maxPerpReach(c: Contour): number {
  let max = 0;
  for (let i = 0; i < c.len; i++) {
    const ph = c.buf[(i << 2) + 1];
    if (ph > max) max = ph;
  }
  return max;
}

// _envelopeMinAlong(c) -> number
//
// Minimum alongValue across all segments in c. For an empty contour,
// returns +Infinity. Used by candidate bbox computation to find a
// subtree's leftmost extent in the parent's along axis.
function _envelopeMinAlong(c: Contour): number {
  let min = Infinity;
  for (let i = 0; i < c.len; i++) {
    const a = c.buf[(i << 2) + 2];
    if (a < min) min = a;
  }
  return min;
}

// _isMirrorInvariant(bot, top) -> boolean
//
// True iff the subtree's natural envelopes are unchanged by mirroring
// across its road. Mirror swaps bottom <-> top with alongValue negation;
// the subtree is invariant when bottom == -top per segment.
//
// Used to prune the mirrored variant from per-placement evaluation when
// it would be a no-op (files, symmetric subtrees). Compares segment
// counts then per-segment perp ranges and negated alongValues within
// OVERLAP_EPS.
function _isMirrorInvariant(bot: Contour, top: Contour): boolean {
  if (bot.len !== top.len) return false;
  for (let i = 0; i < bot.len; i++) {
    const o = i << 2;
    if (Math.abs(bot.buf[o] - top.buf[o]) > OVERLAP_EPS) return false;
    if (Math.abs(bot.buf[o + 1] - top.buf[o + 1]) > OVERLAP_EPS) return false;
    if (Math.abs(bot.buf[o + 2] + top.buf[o + 2]) > OVERLAP_EPS) return false;
  }
  return true;
}

// _mirrorEnvelopes(bot, top) -> { bottom, top }
//
// Reflect a subtree's envelopes across its own road (perp axis flip).
// The subtree's perp values negate; bottom (min perp per slice) becomes
// the negated top (since min(-x) = -max(x)) and vice versa. The contour
// segment perpLow/perpHigh ranges are over the SUBTREE's along axis
// (sweep axis), which is unchanged by perp-axis flip — so segment ranges
// pass through; only alongValues swap and negate.
//
// Returns NEW contours; the inputs are not mutated.
function _mirrorEnvelopes(
  bot: Contour,
  top: Contour
): { bottom: Contour; top: Contour } {
  const newBottom = _emptyContour();
  for (let i = 0; i < top.len; i++) {
    const o = i << 2;
    _appendSegment(newBottom, top.buf[o], top.buf[o + 1], -top.buf[o + 2]);
  }
  const newTop = _emptyContour();
  for (let i = 0; i < bot.len; i++) {
    const o = i << 2;
    _appendSegment(newTop, bot.buf[o], bot.buf[o + 1], -bot.buf[o + 2]);
  }
  return { bottom: newBottom, top: newTop };
}

// _candidateBboxInParent(bot, top, stemX, side, mirrored) -> BBox
//
// Compute a candidate placement's bbox in the parent's local frame.
//   - alongMin/alongMax: the candidate's extent in the PARENT's along
//     axis (= the subtree's perp axis in subtree-local frame). Shifted by
//     stemX. If mirrored, the natural [minA, maxA] becomes [stemX - maxA,
//     stemX - minA].
//   - perpMin/perpMax: the candidate's extent in the PARENT's perp axis
//     (= the subtree's along axis = the contour segment perp range). For
//     side 1 (positive perp), passes through; for side 0, negated and
//     swapped.
//
// Treats empty envelopes as a zero-size point at (stemX, 0) in the
// parent frame.
function _candidateBboxInParent(
  bot: Contour,
  top: Contour,
  stemX: number,
  side: 0 | 1,
  mirrored: boolean
): BBox {
  // Natural along range from envelopes.
  let aMinNat = _envelopeMinAlong(bot);
  let aMaxNat = _maxAlongValue(top);
  if (aMinNat === Infinity) aMinNat = 0;
  if (aMaxNat === -Infinity) aMaxNat = 0;

  // Natural perp range from segment perpLow/perpHigh (use top; bottom
  // has identical perp ranges by construction).
  let pMinNat = _envelopePerpMin(top);
  let pMaxNat = _maxPerpReach(top);
  if (pMinNat === Infinity) pMinNat = 0;
  // _maxPerpReach returns 0 for empty, which is correct here.

  const alongMin = mirrored ? stemX - aMaxNat : stemX + aMinNat;
  const alongMax = mirrored ? stemX - aMinNat : stemX + aMaxNat;
  const perpMin = side === 0 ? -pMaxNat : pMinNat;
  const perpMax = side === 0 ? -pMinNat : pMaxNat;

  // Fix signed zeros: when perpMax ends up as -0, normalize to +0
  return {
    alongMin,
    alongMax,
    perpMin,
    perpMax: perpMax === 0 ? 0 : perpMax,
  };
}

// _bboxUnionMaxDim(a, b) -> number
//
// max(width, height) of the bbox union. Used as the variant scoring
// metric: lower max-dim = more compact (square) parent bbox after the
// candidate placement. Encodes "grow into the smaller axis first."
function _bboxUnionMaxDim(a: BBox, b: BBox): number {
  const aMin = Math.min(a.alongMin, b.alongMin);
  const aMax = Math.max(a.alongMax, b.alongMax);
  const pMin = Math.min(a.perpMin, b.perpMin);
  const pMax = Math.max(a.perpMax, b.perpMax);
  const w = aMax - aMin;
  const h = pMax - pMin;
  return w > h ? w : h;
}

// _maxAlongValue(c) -> number
//
// Maximum alongValue across all segments in c. For an empty contour, returns
// -Infinity. Used by the B re-compute guard to compare two top-envelope
// candidates: when the re-computed envelope's max along is greater than the
// pre-compute's, a side flip inside the child has produced a worse contour
// and we keep the pre-compute instead.
function _maxAlongValue(c: Contour): number {
  let max = -Infinity;
  for (let i = 0; i < c.len; i++) {
    const a = c.buf[(i << 2) + 2];
    if (a > max) max = a;
  }
  return max;
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
        overlap: _intersectRect(A.rect, B.rect),
        category,
      });
    }
  }
  return out;
}

// Internal helpers exposed for tests only. Not part of the public API.
export const __test = {
  _rectsOverlap,
  _collectRects,
  _collectRectsBuf,
  _bboxOfRects,
  rectCount,
  rectAt,
  rectsToBuf,
  bufToRects,
  _emptyContour,
  _appendSegment,
  _contourAt,
  _envelopesFromRects,
  _slideUntilClear,
  _mergeTopContour,
  _preseedGrandparentBlock,
  _envelopeMinAlong,
  _envelopePerpMin,
  _isMirrorInvariant,
  _mirrorEnvelopes,
  _candidateBboxInParent,
  _bboxUnionMaxDim,
};
