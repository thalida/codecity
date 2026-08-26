// city/layout/stemSolver.ts — the forbidden-interval gap-fit packer. Given a
// child's local rects and a parent's occupancy, computes the smallest stem
// offset (and side/mirror variant) that avoids overlap with everything already
// placed. Pure data; no DOM or Three.js.

import { StreetAxis } from '@/types';
import { OVERLAP_EPS } from './rect';
import type { Rect } from './rect';
import { WorldOccupancy, WorldRectKind } from './occupancyIndex';
import type { WorldRect } from './occupancyIndex';
import { _profNow, _profEnd, _profCount } from './profiling';

// findSmallestValidStem's sort-free scan grows the stem one forbidden-interval
// link per round (O(F·chain)). Past this many rounds the chain is long enough
// that a one-off O(F log F) sorted scan is cheaper, so we fall back to it.
const STEM_SCAN_SORT_FALLBACK_ROUNDS = 32;

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
  // Slack: the pair test tolerates eps on both center and width. Erring wide is
  // free, since a mirror variant of an invariant list ties and loses the
  // tiebreak to its non-mirrored twin.
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
// Interval endpoints for one call; module-level and reused (called in a loop,
// never recursively, so one pair of buffers is safe).
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

  // The stem only ever grows from this baseline, so obstacles behind the
  // frontier can never bind — clip the query's low end past them (maxSep keeps
  // the clip conservative, so output stays bit-identical).
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

  // Smallest stem ≥ baseline not covered by the forbidden intervals: grow s
  // through their contiguous chain from the baseline. Avoiding the sort here
  // (the chain is a few links) was the bulk of the speedup. trace keeps the
  // sorted scan so its bindingIndex stays meaningful.
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
