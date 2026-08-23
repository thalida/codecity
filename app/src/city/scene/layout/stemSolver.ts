// city/layout/stemSolver.ts — the forbidden-interval gap-fit packer. Given a
// child's local rects and a parent's occupancy, computes the smallest stem
// offset (and side/mirror variant) that avoids overlap with everything already
// placed. Pure data; no DOM or Three.js.

import { StreetAxis } from '@/city/scene/types';
import { OVERLAP_EPS } from './rect';
import type { Rect } from './rect';
import { WorldOccupancy, WorldRectKind } from './occupancyIndex';
import type { WorldRect } from './occupancyIndex';
import { _profNow, _profEnd, _profCount } from './profiling';

// The sort-free scan grows the stem one link per round, so past this many the
// chain is long enough that one sorted pass is cheaper.
const STEM_SCAN_SORT_FALLBACK_ROUNDS = 32;

// ─── Stem-placement diagnostic types ────────────────────────────────────────
// The "Diagnose stem placement" button. Filled only when a `trace` is passed.

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
  /** Index of the forbidden interval whose upper set the final stem, or null
   *  when the stem stayed at the baseline. */
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

// side flips the child across the parent's perpendicular axis, mirror across
// its long one — which axis is which depends on the parent's orientation.
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

// Negates the rect's centre per flag; w/d are unchanged, since these are AABBs.
export function applyFlips(rect: Rect, flipX: boolean, flipY: boolean): Rect {
  return {
    x: flipX ? -rect.x : rect.x,
    y: flipY ? -rect.y : rect.y,
    w: rect.w,
    d: rect.d,
  };
}

// Whether mirroring leaves the rect list unchanged, in which case the
// mirror=true variants are no-ops and get skipped.
export function isMirrorInvariant(rects: Rect[], parentOrient: StreetAxis): boolean {
  // Empty list is trivially invariant.
  if (rects.length === 0) return true;
  // Invariance needs the extent about 0 to be symmetric. O(n), and it rejects
  // subtrees (which grow away from the origin) before the O(n²) search.
  const mirrorIsX = parentOrient === StreetAxis.X;
  let lo = +Infinity;
  let hi = -Infinity;
  for (const r of rects) {
    const c = mirrorIsX ? r.x : r.y;
    const half = (mirrorIsX ? r.w : r.d) / 2;
    if (c - half < lo) lo = c - half;
    if (c + half > hi) hi = c + half;
  }
  // Erring wide is free: a mirror of an invariant list ties and loses the
  // tiebreak to its twin.
  if (Math.abs(lo + hi) > 4 * OVERLAP_EPS) return false;

  // For each rect r in rects, the mirrored r must also exist in rects.
  // O(n²) but n is small per subtree; acceptable.
  for (const r of rects) {
    let found = false;
    // Depends only on r.
    const mirrorX = mirrorIsX ? -r.x : r.x;
    const mirrorY = mirrorIsX ? r.y : -r.y;
    for (const s of rects) {
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
  // Clearance is max(child's gap, obstacle's gap), so anything next to a side
  // street gets the street gap while building↔building keeps the smaller one.
  buildingGap: number;
  streetGap: number;
  childKind: WorldRectKind; // kind of the child being placed
  occupancy: WorldOccupancy; // global occupancy structure
}

// For one (side, mirror) variant: the smallest stem at or above the baseline
// where no child rect overlaps, from the union of what each obstacle forbids.

// Interval endpoints, reused: called in a loop, never recursively.
let _loScratch = new Float64Array(256);
let _hiScratch = new Float64Array(256);

function _growScratch(buf: Float64Array<ArrayBuffer>): Float64Array<ArrayBuffer> {
  const next = new Float64Array(buf.length * 2);
  next.set(buf);
  return next;
}

export function findSmallestValidStem(
  p: FindSmallestValidStemParams,
  trace?: VariantTrace
): number {
  const _t0 = _profNow();
  const { flipX, flipY } = computeFlips(p.parentOrient, p.side, p.mirror);
  // Gap the placing child reserves around itself (by its kind).
  const placingGap = p.childKind === WorldRectKind.Street ? p.streetGap : p.buildingGap;

  // The stem only grows, so nothing behind the frontier can bind: clipping the
  // query there is conservative enough to stay bit-identical.
  const baseline = Math.max(p.priorStem, p.originPad);
  const maxSep = Math.max(p.buildingGap, p.streetGap);

  // Hot path collects interval endpoints into parallel number arrays (no object,
  // no sort); trace keeps full records for the stem-placement debugger.
  const tracing = trace !== undefined;
  const forbidden: ForbiddenIntervalRecord[] = [];
  // Reused scratch rather than two fresh arrays per call: a large repo pushes
  // ~32M endpoints across ~240k calls, so allocation and regrowth dominate.
  let loCount = 0;

  // Orientation is fixed for the whole call, and the inner loop runs per
  // candidate (~32M times on a large repo), so decide it once.
  const alongIsX = p.parentOrient === StreetAxis.X;

  for (let rIdx = 0; rIdx < p.childRects.length; rIdx++) {
    const r = p.childRects[rIdx];
    const flipped = applyFlips(r, flipX, flipY);

    let alongMin0: number, alongMax0: number, perpMin: number, perpMax: number;
    if (alongIsX) {
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

    // Skip obstacles whose far edge is behind the frontier (−1 margin for FP).
    const loAlong = alongMin0 + baseline - maxSep - 1;
    const candidates = alongIsX
      ? p.occupancy.query(loAlong, perpMin, Infinity, perpMax)
      : p.occupancy.query(perpMin, loAlong, perpMax, Infinity);
    _profCount('stem.queries', 1);
    _profCount('stem.candidates', candidates.length);

    for (const g of candidates) {
      const gMinAlong = alongIsX ? g.minX : g.minY;
      const gMaxAlong = alongIsX ? g.maxX : g.maxY;

      // The parent-body phantom is not a sibling: PARENT_JOIN_PAD spaces it.
      // Real siblings take max-of-both-kinds, whatever the placement order.
      const obsGap = g.kind === WorldRectKind.Street ? p.streetGap : p.buildingGap;
      const sep = g.parentBody ? p.buildingGap : Math.max(placingGap, obsGap);
      const lower = gMinAlong - alongMax0 - sep;
      const upper = gMaxAlong - alongMin0 + sep;
      if (upper > lower) {
        if (tracing) {
          forbidden.push({ lower, upper, obstacle: g, fromChildRectIndex: rIdx });
        } else {
          if (loCount === _loScratch.length) {
            _loScratch = _growScratch(_loScratch);
            _hiScratch = _growScratch(_hiScratch);
          }
          _loScratch[loCount] = lower;
          _hiScratch[loCount] = upper;
          loCount++;
        }
      }
    }
  }

  // Grow s through the chain rather than sorting: the chain is a few links, and
  // that was the bulk of the speedup. trace still sorts, for bindingIndex.
  let s = baseline;
  if (tracing) {
    forbidden.sort((a, b) => a.lower - b.lower);
    let bindingIndex: number | null = null;
    for (let i = 0; i < forbidden.length; i++) {
      const interval = forbidden[i];
      if (s < interval.lower) break;
      if (s < interval.upper) {
        s = interval.upper;
        bindingIndex = i;
      }
    }
    trace.forbidden = forbidden;
    trace.bindingIndex = bindingIndex;
    trace.stem = s;
  } else {
    const n = loCount;
    for (let rounds = 0; ; rounds++) {
      let ns = s;
      for (let i = 0; i < n; i++) {
        if (_loScratch[i] <= s && _hiScratch[i] > ns) ns = _hiScratch[i];
      }
      if (ns === s) break;
      s = ns;
      // A long chain (e.g. a big flat dir) makes the round loop expensive; finish
      // it with a one-off sorted scan to keep the O(F log F) bound.
      if (rounds > STEM_SCAN_SORT_FALLBACK_ROUNDS) {
        const order = Array.from({ length: n }, (_, i) => i).sort(
          (a, b) => _loScratch[a] - _loScratch[b]
        );
        s = baseline;
        for (const i of order) {
          if (s < _loScratch[i]) break;
          if (s < _hiScratch[i]) s = _hiScratch[i];
        }
        break;
      }
    }
  }

  _profCount('stem.forbidden', tracing ? forbidden.length : loCount);
  _profEnd('findSmallestValidStem', _t0);
  return s;
}

interface PlaceChildParams {
  childRects: Rect[];
  parentOrient: StreetAxis;
  parentOriginX: number;
  parentOriginY: number;
  /** One floor for both sides. `priorStems` wins where it is given. */
  priorStem: number;
  /** A floor per side, so alphabetical-monotonic holds per side rather than
   *  across both: a child can fit below its predecessor on the other one. */
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

// The smallest stem across the 4 (side × mirror) variants, or 2 when mirroring
// is invariant. Ties go to side 0, then to natural over mirrored.
export function placeChild(p: PlaceChildParams, trace?: PlaceChildTrace): PlaceChildResult {
  _profCount('placeChild.calls', 1);
  _profCount('placeChild.childRects', p.childRects.length);
  const _tMirror = _profNow();
  const mirrorInvariant = isMirrorInvariant(p.childRects, p.parentOrient);
  _profEnd('placeChild.isMirrorInvariant', _tMirror);

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
