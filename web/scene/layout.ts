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
//   alongReach: along-axis half-extent that the parent street physically has
//          to cover at the parent boundary (the join strip). For a file:
//          along/2 (file's parent-axis half-extent). For a subdir: half its
//          own main-street width (the join width of the T-intersection).
//          The parent street only needs pavement up to (stemX + alongReach);
//          farther subtree content extends perpendicular to the parent and
//          doesn't require parent-street length.
//   buildings/streets/paths: the same content as `rects`, kept typed for
//          translation back into result arrays once the placement is chosen.
interface LocalChildLayout {
  along: number;
  alongLow: number; // local-frame x of the leftmost rect edge (≤ 0 typically)
  alongReach: number;
  rects: RectBuf;
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

// OccupancyEntry — one placed child's contribution to a side's occupancy.
// Carries the translated rects and a precomputed bbox so overlap checks can
// reject far-away entries in O(1) before iterating their per-rect content.
// For deep trees, where each entry can hold an entire subtree's flattened
// rect list, the bbox fast path keeps the inner loop proportional to the
// number of geometrically-intersecting siblings rather than total rects.
interface OccupancyEntry {
  bbox: Rect;
  rects: RectBuf;
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

// _overlapsAny(candidateBbox, candidateBuf, candidateLen, entries) -> boolean
//
// True iff any rect in `candidateBuf[0..candidateLen)` intersects any rect
// inside any occupancy entry. Bbox-first fast path: for each entry, reject
// when candidateBbox doesn't overlap entry.bbox (O(1) skip), only iterate
// per-rect when bboxes intersect. For deep trees this keeps inner work
// proportional to the number of geometrically-intersecting siblings, not
// total siblings. Reads coords directly from the typed arrays — no per-rect
// object allocation in the hot path.
function _overlapsAny(
  candidateBbox: Rect,
  candidateBuf: RectBuf,
  candidateLen: number,
  entries: OccupancyEntry[]
): boolean {
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (!_rectsOverlap(candidateBbox, e.bbox)) continue; // O(1) skip
    const eBbox = e.bbox;
    const eBx1 = eBbox.x - eBbox.w / 2,
      eBx2 = eBbox.x + eBbox.w / 2;
    const eBy1 = eBbox.y - eBbox.d / 2,
      eBy2 = eBbox.y + eBbox.d / 2;
    const eRects = e.rects;
    const eN = eRects.length >>> 2;
    // Inlined _rectsOverlapBuf for the hot inner loop — avoids function-call
    // overhead in deep trees where this can dominate (millions of pair checks
    // for d4f10).
    //
    // Two-level pruning: per-entry bbox skip eliminates whole entries when
    // the candidate's bbox doesn't overlap the entry's. Per-candidate-rect
    // skip eliminates candidate rects whose own AABB doesn't reach the
    // entry's bbox — only rects on the boundary of the candidate's footprint
    // can contribute to overlap, so this trims the inner loop to ~O(boundary)
    // when both subtrees have many interior rects.
    for (let j = 0; j < candidateLen; j++) {
      const co = j << 2;
      const cx = candidateBuf[co],
        cy = candidateBuf[co + 1],
        cw = candidateBuf[co + 2],
        cd = candidateBuf[co + 3];
      const cx1 = cx - cw / 2,
        cx2 = cx + cw / 2;
      const cy1 = cy - cd / 2,
        cy2 = cy + cd / 2;
      // Inner bbox prune: if THIS candidate rect doesn't intersect the
      // entry's bbox, none of entry.rects can intersect it — skip.
      if (
        !(
          cx1 + OVERLAP_EPS < eBx2 &&
          cx2 - OVERLAP_EPS > eBx1 &&
          cy1 + OVERLAP_EPS < eBy2 &&
          cy2 - OVERLAP_EPS > eBy1
        )
      ) {
        continue;
      }
      for (let k = 0; k < eN; k++) {
        const eo = k << 2;
        const ex = eRects[eo],
          ey = eRects[eo + 1],
          ew = eRects[eo + 2],
          ed = eRects[eo + 3];
        const ex1 = ex - ew / 2,
          ex2 = ex + ew / 2;
        const ey1 = ey - ed / 2,
          ey2 = ey + ed / 2;
        if (
          cx1 + OVERLAP_EPS < ex2 &&
          cx2 - OVERLAP_EPS > ex1 &&
          cy1 + OVERLAP_EPS < ey2 &&
          cy2 - OVERLAP_EPS > ey1
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

// _checkAndAdvance(...) -> { fits, advance }
//
// Combined fit-test + nextEventX in a single pass over the occupancy
// entries. Avoids a duplicate scan when the placement loop both checks
// for fit AND needs to compute the advance on miss. Returns
// `advance = -1` when fits=true (caller doesn't read it).
//
// This is the inner hot loop of _layoutDir for deep trees. Combining the
// two passes is a big win because a SECOND pass of overlapping entries
// would re-execute all the bbox-prune work that the first pass already
// did. Single-pass: each entry is scanned at most once per attempt.
function _checkAndAdvance(
  candidateBbox: Rect,
  candidateBuf: RectBuf,
  candidateLen: number,
  entries: OccupancyEntry[],
  axisAlong: 'x' | 'y'
): { fits: boolean; advance: number } {
  const isX = axisAlong === 'x';
  let bestAdvance = Infinity;
  let anyOverlap = false;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (!_rectsOverlap(candidateBbox, e.bbox)) continue;
    const eBbox = e.bbox;
    const eBx1 = eBbox.x - eBbox.w / 2,
      eBx2 = eBbox.x + eBbox.w / 2;
    const eBy1 = eBbox.y - eBbox.d / 2,
      eBy2 = eBbox.y + eBbox.d / 2;
    const eRects = e.rects;
    const eN = eRects.length >>> 2;
    // Each entry's rects are sorted by along-axis right edge ASCENDING at
    // commit time (see _sortRectsByAlongRight below). Combined with the
    // monotonic-advance property — for fixed cLeft, advance(k) is monotonic
    // increasing with oRight(k) — we can stop the inner k-loop as soon as
    // oRight > cLeft + bestAdvance (no later rect can beat bestAdvance).
    for (let j = 0; j < candidateLen; j++) {
      const co = j << 2;
      const cx = candidateBuf[co],
        cy = candidateBuf[co + 1],
        cw = candidateBuf[co + 2],
        cd = candidateBuf[co + 3];
      const cx1 = cx - cw / 2,
        cx2 = cx + cw / 2;
      const cy1 = cy - cd / 2,
        cy2 = cy + cd / 2;
      const cLeft = isX ? cx1 : cy1;
      // j-prune: skip candidate rects whose own AABB doesn't reach the
      // entry's bbox.
      if (
        !(
          cx1 + OVERLAP_EPS < eBx2 &&
          cx2 - OVERLAP_EPS > eBx1 &&
          cy1 + OVERLAP_EPS < eBy2 &&
          cy2 - OVERLAP_EPS > eBy1
        )
      ) {
        continue;
      }
      for (let k = 0; k < eN; k++) {
        const eo = k << 2;
        const ex = eRects[eo],
          ey = eRects[eo + 1],
          ew = eRects[eo + 2],
          ed = eRects[eo + 3];
        const ex1 = ex - ew / 2,
          ex2 = ex + ew / 2;
        const ey1 = ey - ed / 2,
          ey2 = ey + ed / 2;
        const oRight = isX ? ex2 : ey2;
        // Sorted-prune (early k-exit): once oRight exceeds (cLeft + bestAdvance),
        // no later rect in this entry can produce a smaller advance.
        if (oRight - cLeft >= bestAdvance) break;
        if (
          !(
            cx1 + OVERLAP_EPS < ex2 &&
            cx2 - OVERLAP_EPS > ex1 &&
            cy1 + OVERLAP_EPS < ey2 &&
            cy2 - OVERLAP_EPS > ey1
          )
        ) {
          continue;
        }
        anyOverlap = true;
        const advance = oRight - cLeft;
        if (advance > 0 && advance < bestAdvance) bestAdvance = advance;
      }
    }
  }
  if (!anyOverlap) {
    return { fits: true, advance: -1 };
  }
  if (bestAdvance === Infinity) {
    throw new Error('_checkAndAdvance overlap reported but no positive advance — invariant violated');
  }
  return { fits: false, advance: bestAdvance };
}

// _sortRectsByAlongRightInPlace(buf, axisAlong) — mutates `buf` so its
// rects are ordered by along-axis right edge ASCENDING. Used at commit
// time on a freshly-allocated placedBuf so subsequent _checkAndAdvance
// scans can early-exit the inner per-rect loop once the next rect's
// minimum possible advance exceeds the running best.
//
// Implementation: index sort + permutation rewrite. We allocate one tmp
// Float32Array of the same length to write the permuted contents into,
// then copy back. Avoiding a swap-in-place keeps the algorithm O(n) for
// the rewrite step (an in-place permutation cycle would be the same
// asymptotically but harder to read).
function _sortRectsByAlongRightInPlace(buf: RectBuf, axisAlong: 'x' | 'y'): void {
  const n = buf.length >>> 2;
  if (n <= 1) return;
  const isX = axisAlong === 'x';
  const indices = new Array<number>(n);
  for (let i = 0; i < n; i++) indices[i] = i;
  indices.sort((a, b) => {
    const ao = a << 2;
    const bo = b << 2;
    const aRight = isX ? buf[ao] + buf[ao + 2] / 2 : buf[ao + 1] + buf[ao + 3] / 2;
    const bRight = isX ? buf[bo] + buf[bo + 2] / 2 : buf[bo + 1] + buf[bo + 3] / 2;
    return aRight - bRight;
  });
  // Check if already sorted (very common when entries are committed in
  // collection order from sorted children) — skip the rewrite.
  let alreadySorted = true;
  for (let i = 0; i < n; i++) {
    if (indices[i] !== i) {
      alreadySorted = false;
      break;
    }
  }
  if (alreadySorted) return;
  const tmp = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const src = indices[i] << 2;
    const dst = i << 2;
    tmp[dst] = buf[src];
    tmp[dst + 1] = buf[src + 1];
    tmp[dst + 2] = buf[src + 2];
    tmp[dst + 3] = buf[src + 3];
  }
  buf.set(tmp);
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

// _rectsOverlapBuf(a, ai, b, bi) -> boolean — same semantics as _rectsOverlap
// (with OVERLAP_EPS tolerance), but reads coords directly from RectBufs at
// the given indices. No object allocation.
function _rectsOverlapBuf(a: RectBuf, ai: number, b: RectBuf, bi: number): boolean {
  const ao = ai << 2;
  const bo = bi << 2;
  const ax = a[ao], ay = a[ao + 1], aw = a[ao + 2], ad = a[ao + 3];
  const bx = b[bo], by = b[bo + 1], bw = b[bo + 2], bd = b[bo + 3];
  const ax1 = ax - aw / 2, ax2 = ax + aw / 2;
  const ay1 = ay - ad / 2, ay2 = ay + ad / 2;
  const bx1 = bx - bw / 2, bx2 = bx + bw / 2;
  const by1 = by - bd / 2, by2 = by + bd / 2;
  return (
    ax1 + OVERLAP_EPS < bx2 &&
    ax2 - OVERLAP_EPS > bx1 &&
    ay1 + OVERLAP_EPS < by2 &&
    ay2 - OVERLAP_EPS > by1
  );
}

// _rectsOverlapBufRect(buf, i, r) -> boolean — overlap between a rect inside
// a RectBuf and a stand-alone Rect (used when checking against an
// OccupancyEntry's bbox, which stays a Rect object).
function _rectsOverlapBufRect(buf: RectBuf, i: number, r: Rect): boolean {
  const o = i << 2;
  const ax = buf[o], ay = buf[o + 1], aw = buf[o + 2], ad = buf[o + 3];
  const ax1 = ax - aw / 2, ax2 = ax + aw / 2;
  const ay1 = ay - ad / 2, ay2 = ay + ad / 2;
  const bx1 = r.x - r.w / 2, bx2 = r.x + r.w / 2;
  const by1 = r.y - r.d / 2, by2 = r.y + r.d / 2;
  return (
    ax1 + OVERLAP_EPS < bx2 &&
    ax2 - OVERLAP_EPS > bx1 &&
    ay1 + OVERLAP_EPS < by2 &&
    ay2 - OVERLAP_EPS > by1
  );
}

// _bboxOfBuf(buf, len?) -> Rect — axis-aligned bbox of rects 0..len-1 in buf.
// `len` defaults to rectCount(buf); pass a smaller value when reading from a
// scratch buffer that's only partially populated.
function _bboxOfBuf(buf: RectBuf, len?: number): Rect {
  const n = len !== undefined ? len : rectCount(buf);
  if (n === 0) return { x: 0, y: 0, w: 0, d: 0 };
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const o = i << 2;
    const x = buf[o], y = buf[o + 1], w = buf[o + 2], d = buf[o + 3];
    const x1 = x - w / 2, x2 = x + w / 2;
    const y1 = y - d / 2, y2 = y + d / 2;
    if (x1 < minX) minX = x1;
    if (x2 > maxX) maxX = x2;
    if (y1 < minY) minY = y1;
    if (y2 > maxY) maxY = y2;
  }
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, w: maxX - minX, d: maxY - minY };
}

// _translateInto(out, src, originX, originY, stemX, sideIdx, parentOrient, srcLen?)
//
// In-place translation of src[0..srcLen*4) into out[0..srcLen*4). Mirrors
// _translateChildRects logic. No allocation. Used by the _layoutDir
// placement loop to write each per-attempt translation into a single
// reused scratch buffer instead of newly allocating a Rect[] each time.
function _translateInto(
  out: RectBuf,
  src: RectBuf,
  originX: number,
  originY: number,
  stemX: number,
  sideIdx: 0 | 1,
  parentOrient: StreetAxis,
  srcLen?: number
): void {
  const n = srcLen !== undefined ? srcLen : src.length >>> 2;
  const negateY = parentOrient === StreetAxis.X && sideIdx === 0;
  const negateX = parentOrient === StreetAxis.Y && sideIdx === 0;
  for (let i = 0; i < n; i++) {
    const o = i << 2;
    let lx = src[o];
    let ly = src[o + 1];
    if (parentOrient === StreetAxis.X) {
      lx += stemX;
    } else {
      ly += stemX;
    }
    out[o] = (negateX ? -lx : lx) + originX;
    out[o + 1] = (negateY ? -ly : ly) + originY;
    out[o + 2] = src[o + 2];
    out[o + 3] = src[o + 3];
  }
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

// _sideArea(entries) -> number
//
// Sum of w*d over all rects in this side's occupancy entries. Used as the
// tiebreaker when computing preferredSide in _layoutDir so the city grows
// symmetrically. Reads w/d directly from the RectBuf (interleaved layout:
// each rect occupies 4 floats at o..o+3 = x, y, w, d).
function _sideArea(entries: OccupancyEntry[]): number {
  let area = 0;
  for (let i = 0; i < entries.length; i++) {
    const rects = entries[i].rects;
    const n = rects.length >>> 2;
    for (let j = 0; j < n; j++) {
      const o = j << 2;
      area += rects[o + 2] * rects[o + 3];
    }
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
      // Subdir's join with parent is a T-intersection of width = subdir's own
      // main-street width. The parent only needs pavement up to half that
      // width past the stem; the subdir's far branches extend in PERP
      // directions (or non-zero perp depths), not in the parent's along axis
      // at the parent boundary.
      const subStreetWidth = _streetWidthForDir(children[i] as DirLike);
      subLayouts[i] = {
        along: alongHigh - alongLow,
        alongLow,
        alongReach: subStreetWidth / 2,
        rects: _collectRectsBuf(localResult),
        streets: localResult.streets,
        buildings: localResult.buildings,
        paths: localResult.paths,
      };
    }
  }

  // ---- Per-side occupancy + monotonic stem-x cursor ----------------------
  // Each occupancy entry groups one placed child's translated rects with
  // their bbox so _overlapsAny / _nextEventX can reject far-away entries
  // in O(1) before scanning their rect lists. See OccupancyEntry above.
  const occupancy: OccupancyEntry[][] = [[], []];
  let priorStemX = originPad;
  // maxBoundaryAlong — running max of (chosenStemX + child.alongReach), which
  // is the along-axis extent the parent street physically has to cover at the
  // parent boundary. Tracked incrementally so we don't re-iterate every rect
  // in occupancy at the end (and so far branches of subtree children that
  // extend in the parent's along-axis direction at non-zero perp depth do NOT
  // inflate the parent street's length — they extend perpendicular to the
  // parent and don't require parent-street pavement).
  let maxBoundaryAlong = originPad;

  // Per-attempt translation writes into this single scratch buffer instead
  // of newly allocating a Rect[] each iteration of the placement loop.
  // Sized to the largest child's rect count so any child fits. The buffer
  // is reused across attempts AND across children within this _layoutDir
  // call. Files always have 2 rects (building + path); subdirs vary.
  let maxChildRects = 2;
  for (let i = 0; i < children.length; i++) {
    const sl = subLayouts[i];
    if (sl) {
      const n = sl.rects.length >>> 2;
      if (n > maxChildRects) maxChildRects = n;
    }
  }
  const scratchBuf = new Float32Array(maxChildRects * 4);

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
      local = {
        along,
        alongLow: -along / 2,
        // File's footprint at the parent boundary spans `along` along the
        // parent's axis (centered on the stem).
        alongReach: along / 2,
        rects: fileRectsBuf,
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
    // BRANCH POINTS). Files on OPPOSITE sides of the same street may share
    // a stem (pairing) — opposite occupancies are separate, no collision.
    //
    // The `originPad + (-alongLow)` clamp keeps a child's leftmost rect from
    // extending back past the parent's join end, which would clip into the
    // GRANDPARENT'S street. This only matters when there IS a grandparent
    // (non-root). At root, there is no grandparent — letting the leftmost
    // rect sit anywhere in the negative-x half is fine, the gem's plaza is
    // empty space and the absence of the clamp lets big subtrees nest into
    // it instead of pushing the parent street forward to host them.
    let candidateStemX = Math.max(priorStemX, originPad);
    if (parentStreetWidth !== undefined) {
      candidateStemX = Math.max(candidateStemX, originPad + -local.alongLow);
    }

    let chosenSide: 0 | 1 = 0;
    let chosenStemX = 0;
    // placedRects / placedBbox are always assigned before read (the
    // while(true) loop below only exits via `break` after assigning both).
    let placedRects: RectBuf;
    let placedBbox: Rect;
    const axisAlong: 'x' | 'y' = orientation === StreetAxis.X ? 'x' : 'y';

    // candidateLen = number of rects this child contributes. Read once per
    // child; reused inside the placement loop's per-attempt translation.
    const candidateLen = local.rects.length >>> 2;

    // Side preference (best-fit): try both sides at each candidateStemX;
    // pick the smaller stem-x; tiebreak on smaller side area; final
    // tiebreak on side 0. The loop below already tries sidesToTry in order,
    // so we just need the right ORDER for the inner loop's "first-success"
    // semantics. We compute the order once based on side area; ties go to 0.
    const preferredSide: 0 | 1 = _sideArea(occupancy[0]) <= _sideArea(occupancy[1]) ? 0 : 1;

    while (true) {
      const sidesToTry: (0 | 1)[] = preferredSide === 0 ? [0, 1] : [1, 0];
      let foundFit = false;
      let smallestAdvance = Infinity;
      for (const side of sidesToTry) {
        // Translate into the reused scratch buffer — no per-attempt
        // allocation. translatedBbox reads from the same buffer (only the
        // first candidateLen rects are populated).
        _translateInto(
          scratchBuf,
          local.rects,
          originX,
          originY,
          candidateStemX,
          side,
          orientation,
          candidateLen
        );
        const translatedBbox = _bboxOfBuf(scratchBuf, candidateLen);
        // Single-pass fit-test + advance computation. _checkAndAdvance
        // visits each occupancy entry once: it short-circuits on first
        // overlap if the caller only needs fits, otherwise computes the
        // smallest advance in the same pass.
        const result = _checkAndAdvance(
          translatedBbox,
          scratchBuf,
          candidateLen,
          occupancy[side],
          axisAlong
        );
        if (result.fits) {
          // First-success short-circuits the inner side loop — sidesToTry
          // is already ordered by preferredSide, so the first fit IS the
          // best fit at this candidateStemX.
          const placedBuf = new Float32Array(candidateLen * 4);
          placedBuf.set(scratchBuf.subarray(0, candidateLen * 4));
          chosenSide = side;
          chosenStemX = candidateStemX;
          placedRects = placedBuf;
          placedBbox = translatedBbox;
          foundFit = true;
          break;
        }
        if (result.advance > 0 && result.advance < smallestAdvance) {
          smallestAdvance = result.advance;
        }
      }
      if (foundFit) break;
      if (!isFinite(smallestAdvance) || smallestAdvance <= 0) {
        candidateStemX += childGap;
      } else {
        candidateStemX += smallestAdvance + childGap;
      }
    }

    // Commit the placement. Sort the placed rects by along-axis right edge
    // ASCENDING (in place) so subsequent _checkAndAdvance calls can
    // early-exit the inner per-rect scan when a smaller advance is no
    // longer possible.
    _sortRectsByAlongRightInPlace(placedRects, axisAlong);
    occupancy[chosenSide].push({ bbox: placedBbox, rects: placedRects });
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
  // The parent street physically only needs to reach where children branch
  // off (their stem) plus a small along-axis clearance for that branch's
  // own footprint at the parent boundary — `maxBoundaryAlong` tracks exactly
  // that. Subtree contents past the stem extend perpendicular to the parent
  // and don't require parent-street pavement, so we DO NOT iterate occupancy
  // rects for length here (which would incorrectly include far branches of
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
export const __test = {
  _rectsOverlap,
  _overlapsAny,
  _collectRects,
  _collectRectsBuf,
  _bboxOfRects,
  rectCount,
  rectAt,
  rectsToBuf,
  bufToRects,
  _rectsOverlapBuf,
  _rectsOverlapBufRect,
  _bboxOfBuf,
};
