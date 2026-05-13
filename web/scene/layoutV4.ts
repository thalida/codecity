// layoutV4.ts — Global-occupancy layout packer.
// Replaces the v3 contour-based packer. See
// docs/superpowers/specs/2026-05-10-tier-b-global-occupancy-packer-design.md

import { STREET_LAYOUT, BUILDING_DIMENSIONS, GEM_SIZING } from '@/config/index.js';
import { BuildingOrient, NodeKind, StreetAxis } from '@/types';
import type {
  Building, BuildingPath, CityLayout, RangeStat, Street,
} from '@/types';
import {
  _markJoinSides,
  _mirrorOrient,
  _streetWidthForDir,
  computeFileStats,
  getBuildingDimensions,
  type DirLike,
  type FileLike,
  type Rect,
  type TreeLike,
} from './layout';
import { WorldOccupancy } from './worldOccupancy';
import type { WorldRect, WorldRectKind } from './worldOccupancy';

// ─── Stem-placement diagnostic types ────────────────────────────────────────
// Used by the "Diagnose stem placement" debug button. None of these types
// affect normal layout — they're only populated when an optional `trace`
// param is supplied to findSmallestValidStem / placeChild / _commitDirV4.

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

// ─── Pre-computed subtree types (deferred-commit) ──────────────────────────
// Output of _preComputeDirV4. Captures each dir's road geometry, alphabetically-
// ordered children, and per-child rect lists in each child's own local frame.
// Consumed by _commitDirV4 which decides final positions against the global
// occupancy.

export type PreComputedChild =
  | {
      kind: 'file';
      file: FileLike;
      rects: Rect[];
      /** Advisory placement chosen by pre-compute against the LOCAL
       *  occupancy. Used to build the subtree's bounding box in
       *  _computeSubtreeBBox for parent-level advisory placement. The
       *  commit pass overrides these. */
      advisorySide: 0 | 1;
      advisoryMirror: boolean;
      advisoryStem: number;
    }
  | {
      kind: 'subdir';
      subtree: PreComputedSubtree;
      advisorySide: 0 | 1;
      advisoryMirror: boolean;
      advisoryStem: number;
    };

export interface PreComputedSubtree {
  dir: DirLike;
  /** This dir's road geometry. Length is the pre-compute estimate; commit may
   *  extend it if grandchildren require higher stems. */
  road: { length: number; width: number; orient: StreetAxis };
  /** Padding constants captured at pre-compute, reused at commit. */
  originPad: number;
  endPad: number;
  /** Alphabetical-ordered list of this dir's direct children, with each
   *  child's rect list in that child's OWN local frame (NOT translated to
   *  this dir's frame). The commit pass applies (side, mirror, stem) per
   *  child to translate to this dir's frame, then to world. */
  children: PreComputedChild[];
  /** Bounding box of the subtree in its own local frame, used as a
   *  conservative single-rect summary for advisory placement against the
   *  parent's local occupancy. Built bottom-up during _preComputeDirV4. */
  _localBBox?: Rect;
}

// computeFlips(parentOrient, side, mirror) → {flipX, flipY}
//
// For X-orient parent: side flips perp (Y), mirror flips along (X) of the child.
// For Y-orient parent: side flips perp (X), mirror flips along (Y) of the child.
//
// Matches the existing v3 packer's flip rules so renderer-side expectations
// (T-junction geometry, door direction) are preserved.
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
const OVERLAP_EPS = 1e-9;
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
  childRects: Rect[];           // rects in CHILD-LOCAL frame
  parentOrient: StreetAxis;
  side: 0 | 1;
  mirror: boolean;
  parentOriginX: number;        // parent's main-street origin in world
  parentOriginY: number;
  /** Whether the parent's local X axis is reversed in world (cumulative flip
   *  from outer ancestors). Defaults to false (root call). */
  parentFlipX?: boolean;
  /** Whether the parent's local Y axis is reversed in world. Defaults to
   *  false. */
  parentFlipY?: boolean;
  priorStem: number;            // alphabetical-monotonic: stem ≥ priorStem
  originPad: number;            // stem ≥ originPad (parent's join clearance)
  childGap: number;             // minimum gap between this child and others
  occupancy: WorldOccupancy;    // global occupancy structure
}

// findSmallestValidStem — Section 3 of the spec.
//
// For one (side, mirror) variant, compute the smallest stem ≥ max(priorStem,
// originPad) such that translating every child rect by (side, mirror, stem,
// parentOrigin) doesn't overlap any rect in occupancy. Uses the forbidden-
// interval union algorithm for gap-fit packing.
//
// Optional `trace` param: when provided, the function fills in
// trace.forbidden with the obstacle + child-rect provenance of every
// forbidden interval, trace.bindingIndex with the index of the interval that
// set the final stem (or null if the chosen stem equals the baseline), and
// trace.stem with the returned value. The trace param has no effect on the
// algorithm or return value; it is purely an out-parameter.
export function findSmallestValidStem(
  p: FindSmallestValidStemParams,
  trace?: VariantTrace,
): number {
  const { flipX, flipY } = computeFlips(p.parentOrient, p.side, p.mirror);
  const signX = p.parentFlipX ? -1 : 1;
  const signY = p.parentFlipY ? -1 : 1;

  // Collect forbidden stem intervals from all (childRect, candidate) pairs.
  const forbidden: ForbiddenIntervalRecord[] = [];

  for (let rIdx = 0; rIdx < p.childRects.length; rIdx++) {
    const r = p.childRects[rIdx];
    const flipped = applyFlips(r, flipX, flipY);

    // World-frame perp band and along-at-stem-0 window for THIS rect.
    // alongSign captures whether stems grow in +world or -world along axis.
    let alongMin0_world: number;
    let alongMax0_world: number;
    let perpMin_world: number;
    let perpMax_world: number;
    let alongSign: number;
    if (p.parentOrient === StreetAxis.X) {
      // along = X, perp = Y
      alongSign = signX;
      const alongCenterWorld = p.parentOriginX + signX * flipped.x;
      alongMin0_world = alongCenterWorld - flipped.w / 2;
      alongMax0_world = alongCenterWorld + flipped.w / 2;
      const perpCenterWorld = p.parentOriginY + signY * flipped.y;
      perpMin_world = perpCenterWorld - flipped.d / 2;
      perpMax_world = perpCenterWorld + flipped.d / 2;
    } else {
      // along = Y, perp = X
      alongSign = signY;
      const alongCenterWorld = p.parentOriginY + signY * flipped.y;
      alongMin0_world = alongCenterWorld - flipped.d / 2;
      alongMax0_world = alongCenterWorld + flipped.d / 2;
      const perpCenterWorld = p.parentOriginX + signX * flipped.x;
      perpMin_world = perpCenterWorld - flipped.w / 2;
      perpMax_world = perpCenterWorld + flipped.w / 2;
    }

    // Query occupancy in r's perp band (in world coords).
    const candidates =
      p.parentOrient === StreetAxis.X
        ? p.occupancy.query(-Infinity, perpMin_world, Infinity, perpMax_world)
        : p.occupancy.query(perpMin_world, -Infinity, perpMax_world, Infinity);

    for (const g of candidates) {
      const gMinAlong = p.parentOrient === StreetAxis.X ? g.minX : g.minY;
      const gMaxAlong = p.parentOrient === StreetAxis.X ? g.maxX : g.maxY;

      let lower: number;
      let upper: number;
      if (alongSign === 1) {
        // Rect at stem S has world.along range = [alongMin0_world + S, alongMax0_world + S].
        // Overlap with g iff S ∈ (g.minAlong - alongMax0_world, g.maxAlong - alongMin0_world).
        lower = gMinAlong - alongMax0_world - p.childGap;
        upper = gMaxAlong - alongMin0_world + p.childGap;
      } else {
        // alongSign = -1: stem S in subtree.local maps to -S in world.along.
        // Rect at stem S has world.along range = [alongMin0_world - S, alongMax0_world - S].
        // Overlap with g iff S ∈ (alongMin0_world - g.maxAlong, alongMax0_world - g.minAlong).
        lower = alongMin0_world - gMaxAlong - p.childGap;
        upper = alongMax0_world - gMinAlong + p.childGap;
      }
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
   *  both sides (i.e., V4's original cross-side alphabetical-monotonic
   *  behavior). When supplied, lets a child on side A fit at a lower stem
   *  than its alphabetical predecessor on side B — the alphabetical-monotonic
   *  invariant is then enforced PER SIDE rather than across both sides. */
  priorStems?: readonly [number, number];
  originPad: number;
  childGap: number;
  occupancy: WorldOccupancy;
}

export interface PlaceChildResult {
  stem: number;
  side: 0 | 1;
  mirror: boolean;
}

// placeChild — Section 4 of the spec.
//
// Evaluates 4 (side × mirror) variants and picks the one with smallest stem.
// If mirror is invariant (the rect list is unchanged by perp-axis flip), only
// 2 variants (mirror=false) are evaluated.
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
export function placeChild(
  p: PlaceChildParams,
  trace?: PlaceChildTrace,
): PlaceChildResult {
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
        childGap: p.childGap,
        occupancy: p.occupancy,
      },
      variantTrace,
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
    const worldX =
      flipped.x +
      parentOriginX +
      (parentOrient === StreetAxis.X ? stem : 0);
    const worldY =
      flipped.y +
      parentOriginY +
      (parentOrient === StreetAxis.Y ? stem : 0);
    const typed = r as TypedRect;
    out.push({
      minX: worldX - flipped.w / 2,
      minY: worldY - flipped.d / 2,
      maxX: worldX + flipped.w / 2,
      maxY: worldY + flipped.d / 2,
      kind: typed.kind ?? 'building',
      ref: typed.ref ?? ({} as never),
    });
  }
  return out;
}

// _preComputeDirV4 — bottom-up pass that produces a PreComputedSubtree
// describing this dir's road geometry and per-child rect lists. Uses a
// LOCAL occupancy for collision checks to determine road length. Does NOT
// insert anything into a global occupancy; commit (_commitDirV4) does that.
//
// Mirrors v3 _layoutDir's algorithm but discards the final positions —
// commit (_commitDirV4) re-computes them against the global occupancy.
export function _preComputeDirV4(
  dir: DirLike,
  parentStreetWidth: number | undefined,
  lineStats: RangeStat,
  byteStats: RangeStat,
  occupancy: WorldOccupancy,
  trace?: StemPlacementTrace,
  /** Parent's road extent (max along-edge of its children placed so far, in
   *  parent's local frame) at the time this recursive call begins. Used to
   *  bound the phantom's perp range. Undefined at the top-level call. */
  parentMaxBoundary?: number,
): void {
  // ----- Tunables (one .get() per call, matching v3 pattern) -----
  const streetLayout = STREET_LAYOUT.get();
  const childGap = streetLayout.CHILD_GAP;
  const parentJoinPad = streetLayout.PARENT_JOIN_PAD;
  const rootEndPad = streetLayout.ROOT_END_PAD;
  const bldgDims = BUILDING_DIMENSIONS.get();
  const bldgPathLength = bldgDims.PATH_LENGTH;
  const pathWidthFrac = bldgDims.PATH_WIDTH_FRAC;

  // ----- Padding chain -----
  const myStreetWidth = _streetWidthForDir(dir);
  const openEndPad = myStreetWidth / 2 + bldgPathLength;
  const joinEndBaseline = parentStreetWidth
    ? parentStreetWidth / 2 + parentJoinPad
    : rootEndPad;
  const endPad = parentStreetWidth
    ? Math.max(joinEndBaseline, openEndPad)
    : Math.max(rootEndPad, openEndPad);
  const gemSizing = GEM_SIZING.get();
  const gemRadiusFrac = gemSizing.RADIUS_AS_STREET_FRAC;
  const gemClearance = gemSizing.BUILDING_CLEARANCE;
  const originPad = !parentStreetWidth
    ? Math.max(endPad, myStreetWidth * (0.5 + gemRadiusFrac) + gemClearance)
    : joinEndBaseline;

  // ----- Pre-seed parent's street body into occupancy (V4 analogue of v3's
  // _preseedGrandparentBlock). Forces children's stems to clear the parent
  // main street's perp footprint, replacing v3's contour-based per-perp
  // constraint with a phantom-rect collision check.
  //
  // Phantom geometry in THIS dir's local frame:
  //   - Along this dir's ALONG axis: spans ±parentStreetWidth/2 (parent's
  //     width). This dir's join end sits at along=0; the parent's body
  //     extends to ±parentW/2 on either side of the join.
  //   - Along this dir's PERP axis: bounded by the parent's road extent.
  //     The phantom represents the parent's road BODY, which has a finite
  //     along-length, not an infinite one. Using parentMaxBoundary (the
  //     extent of parent's road known so far) as the bound stops the
  //     phantom from over-blocking grandchildren that would actually land
  //     past parent's road. A small additional buffer guards against the
  //     parent's road growing further when siblings after this dir get
  //     placed. Falls back to a large default at the root call where the
  //     bound is unknown but no parent road exists either.
  //
  // Skipped at the root call (parentStreetWidth undefined), where no parent
  // body exists. -----
  if (parentStreetWidth !== undefined && parentStreetWidth > 0) {
    const halfP = parentStreetWidth / 2;
    // PHANTOM_FAR is the fallback when no parentMaxBoundary is supplied
    // (legacy callers). Real subdir recursions pass parentMaxBoundary, and
    // we use that + a generous safety buffer so later siblings extending
    // the parent road can still grow without our grandchildren overlapping
    // the (now-extended) parent body.
    const PHANTOM_FAR = 1e9;
    const phantomReach =
      parentMaxBoundary !== undefined
        ? parentMaxBoundary * 2 + 1000
        : PHANTOM_FAR;
    const phantomMinX = orientation === StreetAxis.X ? -halfP : -phantomReach;
    const phantomMaxX = orientation === StreetAxis.X ? +halfP : +phantomReach;
    const phantomMinY = orientation === StreetAxis.Y ? -halfP : -phantomReach;
    const phantomMaxY = orientation === StreetAxis.Y ? +halfP : +phantomReach;
    occupancy.insert({
      minX: phantomMinX,
      minY: phantomMinY,
      maxX: phantomMaxX,
      maxY: phantomMaxY,
      kind: 'street',
      ref: {
        x: 0, y: 0, length: 0, width: parentStreetWidth,
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
  // a stem range instead of being forced apart by V4's original cross-side
  // alphabetical-monotonic constraint.
  const priorStems: [number, number] = [originPad, originPad];
  // maxBoundaryAlong tracks the far edge of the last-placed child, used to
  // size the own street at the end.
  let maxBoundaryAlong = originPad;

  for (const child of children) {
    if (child.type === NodeKind.File) {
      const dim = getBuildingDimensions(child as FileLike, lineStats, byteStats);
      const along = dim.w;
      const perpDepth = dim.d;
      const perpCenter = myStreetWidth / 2 + bldgPathLength + perpDepth / 2;
      let bx: number, by: number, bw: number, bd: number;
      if (orientation === StreetAxis.X) {
        bx = 0; by = perpCenter; bw = along; bd = perpDepth;
      } else {
        bx = perpCenter; by = 0; bw = perpDepth; bd = along;
      }
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
      const childRects: Rect[] = [
        { x: bx, y: by, w: bw, d: bd },
        { x: px, y: py, w: pw, d: pd },
      ];

      // Find a stem using LOCAL occupancy (advisory — commit overrides).
      const placed = placeChild({
        childRects,
        parentOrient: orientation,
        parentOriginX: 0,
        parentOriginY: 0,
        priorStem,
        originPad,
        childGap,
        occupancy: localOccupancy,
      });

      // Insert into LOCAL occupancy at advisory position so subsequent
      // children's pre-compute stems are alphabetical-monotonic.
      const { flipX, flipY } = computeFlips(orientation, placed.side, placed.mirror);
      const buildingLocal = applyFlips({ x: bx, y: by, w: bw, d: bd }, flipX, flipY);
      const pathLocal = applyFlips({ x: px, y: py, w: pw, d: pd }, flipX, flipY);
      const stemAlong = placed.stem;
      const buildingLocalX = buildingLocal.x + (orientation === StreetAxis.X ? stemAlong : 0);
      const buildingLocalY = buildingLocal.y + (orientation === StreetAxis.Y ? stemAlong : 0);
      const pathLocalX = pathLocal.x + (orientation === StreetAxis.X ? stemAlong : 0);
      const pathLocalY = pathLocal.y + (orientation === StreetAxis.Y ? stemAlong : 0);
      localOccupancy.insert({
        minX: buildingLocalX - buildingLocal.w / 2,
        minY: buildingLocalY - buildingLocal.d / 2,
        maxX: buildingLocalX + buildingLocal.w / 2,
        maxY: buildingLocalY + buildingLocal.d / 2,
        kind: 'building',
        ref: null as unknown as Building,
      });
      localOccupancy.insert({
        minX: pathLocalX - pathLocal.w / 2,
        minY: pathLocalY - pathLocal.d / 2,
        maxX: pathLocalX + pathLocal.w / 2,
        maxY: pathLocalY + pathLocal.d / 2,
        kind: 'path',
        ref: null as unknown as BuildingPath,
      });

      result.push({
        kind: 'file',
        file: child as FileLike,
        rects: childRects,
        advisorySide: placed.side,
        advisoryMirror: placed.mirror,
        advisoryStem: placed.stem,
      });
      priorStem = placed.stem;
      const boundaryHigh = placed.stem + along / 2;
      if (boundaryHigh > maxBoundaryAlong) maxBoundaryAlong = boundaryHigh;
    } else {
      // Subdir: recurse, then advisory-place its FULL subtree rect list in
      // local occupancy. Using the full subtree (not just the road) makes
      // this dir's road length an honest upper bound — the commit pass
      // still uses just the road rect for parent-level collision.
      const subtree = _preComputeDirV4(child as DirLike, myStreetWidth, lineStats, byteStats, subOrient);

      // Advisory placement uses the subtree's bounding box (one rect, conservative
      // upper bound). Full rect list was O(N·D²) on large trees.
      const subChildRects = [_computeSubtreeBBox(subtree)];
      const placed = placeChild({
        childRects: subChildRects,
        parentOrient: orientation,
        parentOriginX: 0,
        parentOriginY: 0,
        priorStem,
        originPad,
        childGap,
        occupancy: localOccupancy,
      });

      // Insert subdir's advisory bbox footprint into local occupancy.
      const { flipX, flipY } = computeFlips(orientation, placed.side, placed.mirror);
      const subAnchorX = orientation === StreetAxis.X ? placed.stem : 0;
      const subAnchorY = orientation === StreetAxis.X ? 0 : placed.stem;
      for (const r of subChildRects) {
        const flipped = applyFlips(r, flipX, flipY);
        const wx = flipped.x + subAnchorX;
        const wy = flipped.y + subAnchorY;
        localOccupancy.insert({
          minX: wx - flipped.w / 2,
          minY: wy - flipped.d / 2,
          maxX: wx + flipped.w / 2,
          maxY: wy + flipped.d / 2,
          kind: 'street',
          ref: null as unknown as Street,
        });
      }

      result.push({
        kind: 'subdir',
        subtree,
        advisorySide: placed.side,
        advisoryMirror: placed.mirror,
        advisoryStem: placed.stem,
      });
      priorStem = placed.stem;
      const boundaryHigh = placed.stem + subtree.road.width / 2;
      if (boundaryHigh > maxBoundaryAlong) maxBoundaryAlong = boundaryHigh;
    }
  }

  const roadLength = Math.max(maxBoundaryAlong + endPad, originPad + endPad);
  return {
    dir,
    road: { length: roadLength, width: myStreetWidth, orient: orientation },
    originPad,
    endPad,
    children: result,
  };
}

// _computeSubtreeBBox — returns a single bounding-box rect covering the
// subtree's footprint in its own local frame. Used by _preComputeDirV4 for
// advisory placement against the parent's local occupancy (conservative
// upper bound on the subtree's perp extent + road length). O(1) per call
// if cached, O(|subtree's direct children|) on first call (children's
// bboxes are themselves cached).
function _computeSubtreeBBox(subtree: PreComputedSubtree): Rect {
  if (subtree._localBBox) return subtree._localBBox;

  // Start with the subtree's own road rect.
  let minX: number, minY: number, maxX: number, maxY: number;
  if (subtree.road.orient === StreetAxis.X) {
    minX = 0;
    maxX = subtree.road.length;
    minY = -subtree.road.width / 2;
    maxY = subtree.road.width / 2;
  } else {
    minX = -subtree.road.width / 2;
    maxX = subtree.road.width / 2;
    minY = 0;
    maxY = subtree.road.length;
  }

  // Union each child's bbox (after applying its advisory flip + stem).
  for (const child of subtree.children) {
    const { flipX, flipY } = computeFlips(subtree.road.orient, child.advisorySide, child.advisoryMirror);
    const stemX = subtree.road.orient === StreetAxis.X ? child.advisoryStem : 0;
    const stemY = subtree.road.orient === StreetAxis.Y ? child.advisoryStem : 0;

    if (child.kind === 'file') {
      // File contributes its building + path rects (in child's local frame).
      for (const r of child.rects) {
        const fx = flipX ? -r.x : r.x;
        const fy = flipY ? -r.y : r.y;
        const cMinX = fx - r.w / 2 + stemX;
        const cMaxX = fx + r.w / 2 + stemX;
        const cMinY = fy - r.d / 2 + stemY;
        const cMaxY = fy + r.d / 2 + stemY;
        if (cMinX < minX) minX = cMinX;
        if (cMaxX > maxX) maxX = cMaxX;
        if (cMinY < minY) minY = cMinY;
        if (cMaxY > maxY) maxY = cMaxY;
      }
    } else {
      // Subdir: union its bbox (recursively computed).
      const subBBox = _computeSubtreeBBox(child.subtree);
      // Apply child's variant flip + stem to subBBox, then union.
      // The flip is around the origin; for a rect with [min, max] range, the
      // flipped range is [-max, -min].
      const flippedMinX = flipX ? -(subBBox.x + subBBox.w / 2) : subBBox.x - subBBox.w / 2;
      const flippedMaxX = flipX ? -(subBBox.x - subBBox.w / 2) : subBBox.x + subBBox.w / 2;
      const flippedMinY = flipY ? -(subBBox.y + subBBox.d / 2) : subBBox.y - subBBox.d / 2;
      const flippedMaxY = flipY ? -(subBBox.y - subBBox.d / 2) : subBBox.y + subBBox.d / 2;
      const cMinX = flippedMinX + stemX;
      const cMaxX = flippedMaxX + stemX;
      const cMinY = flippedMinY + stemY;
      const cMaxY = flippedMaxY + stemY;
      if (cMinX < minX) minX = cMinX;
      if (cMaxX > maxX) maxX = cMaxX;
      if (cMinY < minY) minY = cMinY;
      if (cMaxY > maxY) maxY = cMaxY;
    }
  }

  const bbox: Rect = {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
    w: maxX - minX,
    d: maxY - minY,
  };
  subtree._localBBox = bbox;
  return bbox;
}

// _flattenSubtreeRects — returns just the subtree's road rect in its own
// local frame. Used at both pre-compute (for advisory placement against the
// parent's local occupancy) and commit time (for the actual placement
// against the global occupancy). The subtree's contents (children, paths,
// buildings) get committed individually via _commitDirV4 recursion — they
// don't need to be in the parent-level collision check.
export function _flattenSubtreeRects(subtree: PreComputedSubtree): Rect[] {
  if (subtree.road.orient === StreetAxis.X) {
    return [{
      x: subtree.road.length / 2,
      y: 0,
      w: subtree.road.length,
      d: subtree.road.width,
    }];
  }
  return [{
    x: 0,
    y: subtree.road.length / 2,
    w: subtree.road.width,
    d: subtree.road.length,
  }];
}

// _commitDirV4 — top-down commit pass. Walks a PreComputedSubtree and
// produces final placements into layout (a CityLayout being built). At each
// dir: insert a phantom representing the parent road (so this dir's
// children clear that footprint), iterate this dir's children placing each
// against the GLOBAL occupancy, remove the phantom, then insert this dir's
// own road with its final (possibly extended) length.
//
// Parameters:
//   subtree        — pre-computed subtree to commit
//   originX/Y      — this dir's local origin in world coordinates. For root,
//                    pass (0, 0). For nested dirs, pass the world coords of
//                    the dir's join with its parent road.
//   parentStreetWidth — the parent road's width, or undefined for root.
//   occupancy      — the GLOBAL occupancy. Children are placed against this.
//   layout         — the CityLayout being built; commit pushes streets,
//                    buildings, paths into it.
//   trace          — optional StemPlacementTrace; if provided, each
//                    placeChild call records a ChildPlacementTrace.
export function _commitDirV4(
  subtree: PreComputedSubtree,
  originX: number,
  originY: number,
  parentStreetWidth: number | undefined,
  parentRoadLength: number | undefined,
  anchorFlipX: boolean,
  anchorFlipY: boolean,
  occupancy: WorldOccupancy,
  layout: CityLayout,
  trace?: StemPlacementTrace,
): void {
  const streetLayout = STREET_LAYOUT.get();
  const childGap = streetLayout.CHILD_GAP;

  const orientation = subtree.road.orient;
  const myStreetWidth = subtree.road.width;
  const originPad = subtree.originPad;
  const endPad = subtree.endPad;

  // ----- Step 1: insert a phantom representing the PARENT road -----
  // The phantom occupies the parent road's footprint (perpendicular to this
  // dir's road) with infinite perp extent so this dir's children stems clear
  // it. It's inserted into the global occupancy and removed at the end of
  // this call.
  let phantomRect: WorldRect | null = null;
  if (parentStreetWidth !== undefined && parentStreetWidth > 0 && parentRoadLength !== undefined && parentRoadLength > 0) {
    const halfP = parentStreetWidth / 2;
    // Use the parent road's actual pre-compute length instead of an
    // infinite-ish PHANTOM_FAR. In V4 each subtree had its own local
    // occupancy so PHANTOM_FAR=1e9 was safe; in the new global-occupancy
    // deferred-commit, grandparent phantoms accumulate, and 1e9 creates
    // billion-unit forbidden intervals for descendants.
    const halfL = parentRoadLength / 2;
    const phantomMinX = orientation === StreetAxis.X ? originX - halfP : originX - halfL;
    const phantomMaxX = orientation === StreetAxis.X ? originX + halfP : originX + halfL;
    const phantomMinY = orientation === StreetAxis.Y ? originY - halfP : originY - halfL;
    const phantomMaxY = orientation === StreetAxis.Y ? originY + halfP : originY + halfL;
    phantomRect = {
      minX: phantomMinX, minY: phantomMinY,
      maxX: phantomMaxX, maxY: phantomMaxY,
      kind: 'street',
      ref: {
        x: originX, y: originY, length: 0, width: parentStreetWidth,
        orientation: orientation === StreetAxis.X ? StreetAxis.Y : StreetAxis.X,
        label: '__phantom_parent_body__',
        dir: null as unknown as Street['dir'],
      } as Street,
    };
    occupancy.insert(phantomRect);
  }

  // ----- Step 2: place each child against the global occupancy -----
  const anchorSignX = anchorFlipX ? -1 : 1;
  const anchorSignY = anchorFlipY ? -1 : 1;
  let priorStem = originPad;
  let maxBoundaryAlong = originPad;
  for (const child of subtree.children) {
    if (child.kind === 'file') {
      const variants: VariantTrace[] = [];
      const placed = placeChild(
        {
          childRects: child.rects,
          parentOrient: orientation,
          parentOriginX: originX,
          parentOriginY: originY,
          priorStem: Math.max(priorStems[0], priorStems[1]),
          priorStems,
          originPad,
          childGap,
          occupancy,
        },
        trace ? { variants } : undefined,
      );
      if (trace) {
        const chosenIdx = variants.findIndex(
          (v) => v.side === placed.side && v.mirror === placed.mirror,
        );
        if (chosenIdx < 0) {
          throw new Error(
            `[stem-diag] placed variant not found in trace.variants — placeChild invariant broken (side=${placed.side}, mirror=${placed.mirror})`,
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
      const pathLocal = applyFlips({ x: px, y: py, w: pw, d: pd }, flipX, flipY);

      const stemAlong = placed.stem;
      const buildingWorldX = buildingLocal.x + originX + (orientation === StreetAxis.X ? stemAlong : 0);
      const buildingWorldY = buildingLocal.y + originY + (orientation === StreetAxis.Y ? stemAlong : 0);
      const pathWorldX = pathLocal.x + originX + (orientation === StreetAxis.X ? stemAlong : 0);
      const pathWorldY = pathLocal.y + originY + (orientation === StreetAxis.Y ? stemAlong : 0);

      // Door orientation matches v3 ~lines 1209-1228 in the file branch.
      // Side 0 maps to the flipped perp position (flipY=true for X-orient,
      // flipX=true for Y-orient); the door points toward the parent street.
      let orient: BuildingOrient;
      if (orientation === StreetAxis.X) {
        orient = placed.side === 0 ? BuildingOrient.South : BuildingOrient.North;
      } else {
        orient = placed.side === 0 ? BuildingOrient.East : BuildingOrient.West;
      }
      // For mirror-invariant rect lists (files always are — paths and
      // buildings are centered on the stem along the parent's along axis),
      // placeChild will never pick mirror=true (the tiebreak prefers
      // non-mirror), so this branch is a no-op in practice. Kept defensively
      // to mirror v3 semantics if a future caller passes a non-symmetric
      // file rect.
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
      const pathRect: BuildingPath = {
        x: pathWorldX,
        y: pathWorldY,
        w: pathLocal.w,
        d: pathLocal.d,
        file: child as unknown as BuildingPath['file'],
      };

      result.buildings.push(buildingRect);
      result.paths.push(pathRect);
      const buildingWorldRect: WorldRect = {
        minX: buildingWorldX - buildingLocal.w / 2,
        minY: buildingWorldY - buildingLocal.d / 2,
        maxX: buildingWorldX + buildingLocal.w / 2,
        maxY: buildingWorldY + buildingLocal.d / 2,
        kind: 'building',
        ref: buildingRect,
      };
      occupancy.insert(buildingWorldRect);
      const pathWorldRect: WorldRect = {
        minX: pathWorldX - pathLocal.w / 2,
        minY: pathWorldY - pathLocal.d / 2,
        maxX: pathWorldX + pathLocal.w / 2,
        maxY: pathWorldY + pathLocal.d / 2,
        kind: 'path',
        ref: pathRect,
      };
      occupancy.insert(pathWorldRect);

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
        paths: [],
      };
      const localOccupancy = new WorldOccupancy();
      _layoutDirV4(
        child as DirLike,
        0, 0,
        subOrient,
        childResult,
        myStreetWidth,
        lineStats, byteStats,
        localOccupancy,
        trace,
        maxBoundaryAlong,
      );

      // Build child-local rect list from the subtree result. These are the
      // rects placeChild evaluates for variants (collision testing in the
      // parent's frame).
      const childRects: Rect[] = [];
      for (const s of childResult.streets) {
        if (s.orientation === StreetAxis.X) {
          childRects.push({ x: s.x, y: s.y, w: s.length, d: s.width });
        } else {
          childRects.push({ x: s.x, y: s.y, w: s.width, d: s.length });
        }
      }
      for (const b of childResult.buildings) {
        childRects.push({ x: b.x, y: b.y, w: b.w, d: b.d });
      }
      for (const p of childResult.paths) {
        childRects.push({ x: p.x, y: p.y, w: p.w, d: p.d });
      }

      // Pick variant against the parent's occupancy.
      const variants: VariantTrace[] = [];
      const placed = placeChild(
        {
          childRects: subChildRects,
          parentOrient: orientation,
          parentOriginX: originX,
          parentOriginY: originY,
          priorStem: Math.max(priorStems[0], priorStems[1]),
          priorStems,
          originPad,
          childGap,
          occupancy,
        },
        trace ? { variants } : undefined,
      );
      if (trace) {
        const chosenIdx = variants.findIndex(
          (v) => v.side === placed.side && v.mirror === placed.mirror,
        );
        if (chosenIdx < 0) {
          throw new Error(
            `[stem-diag] placed variant not found in trace.variants — placeChild invariant broken (side=${placed.side}, mirror=${placed.mirror})`,
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

      // Child subdir's anchor in world: subtree.local origin = (stem, 0) for
      // X-orient parent or (0, stem) for Y-orient parent. World = parent's
      // origin + cumulative_flip(subtree.local origin).
      const subOriginX = orientation === StreetAxis.X
        ? originX + anchorSignX * placed.stem
        : originX;
      const subOriginY = orientation === StreetAxis.X
        ? originY
        : originY + anchorSignY * placed.stem;

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
          kind: 'street',
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
          kind: 'building',
          ref: worldBuilding,
        };
        occupancy.insert(buildingWorldRect);
      }
      for (const p of childResult.paths) {
        const worldPath: BuildingPath = {
          x: (flipX ? -p.x : p.x) + subAnchorX,
          y: (flipY ? -p.y : p.y) + subAnchorY,
          w: p.w,
          d: p.d,
          file: p.file,
        };
        result.paths.push(worldPath);
        const pathWorldRect: WorldRect = {
          minX: worldPath.x - p.w / 2,
          minY: worldPath.y - p.d / 2,
          maxX: worldPath.x + p.w / 2,
          maxY: worldPath.y + p.d / 2,
          kind: 'path',
          ref: worldPath,
        };
        occupancy.insert(pathWorldRect);
      }

      priorStems[placed.side] = placed.stem;
      const boundaryHigh = placed.stem + childResult.alongReach;
      if (boundaryHigh > maxBoundaryAlong) maxBoundaryAlong = boundaryHigh;
    }
  }

  // ----- Step 3: remove the phantom, insert the actual road with final length -----
  if (phantomRect) {
    occupancy.remove(phantomRect);
  }

  const finalLength = Math.max(maxBoundaryAlong + endPad, originPad + endPad);
  // The road extends from along=0 to along=finalLength in subtree.local;
  // center is at along=finalLength/2. Apply cumulative anchor flip when
  // mapping to world.
  const halfAlong = finalLength / 2;
  const streetCenterX = orientation === StreetAxis.X
    ? originX + anchorSignX * halfAlong
    : originX;
  const streetCenterY = orientation === StreetAxis.X
    ? originY
    : originY + anchorSignY * halfAlong;
  const ownStreet: Street = {
    x: streetCenterX,
    y: streetCenterY,
    length: finalLength,
    width: myStreetWidth,
    orientation,
    label: subtree.dir.name || '',
    dir: subtree.dir as unknown as Street['dir'],
  };
  layout.streets.push(ownStreet);
  const halfAlongX = orientation === StreetAxis.X ? finalLength / 2 : myStreetWidth / 2;
  const halfAlongY = orientation === StreetAxis.X ? myStreetWidth / 2 : finalLength / 2;
  occupancy.insert({
    minX: streetCenterX - halfAlongX,
    minY: streetCenterY - halfAlongY,
    maxX: streetCenterX + halfAlongX,
    maxY: streetCenterY + halfAlongY,
    kind: 'street',
    ref: ownStreet,
  });
}

// _emitFileAtCommit — translates a leaf file's pre-computed rects (in the
// child's own local frame) to world coordinates using the chosen
// (side, mirror, stem) and pushes the building + path into the layout +
// inserts them into the occupancy.
function _emitFileAtCommit(
  child: { kind: 'file'; file: FileLike; rects: Rect[] },
  placed: PlaceChildResult,
  orientation: StreetAxis,
  originX: number,
  originY: number,
  anchorFlipX: boolean,
  anchorFlipY: boolean,
  layout: CityLayout,
  occupancy: WorldOccupancy,
): void {
  const { flipX: vFlipX, flipY: vFlipY } = computeFlips(orientation, placed.side, placed.mirror);
  const signX = anchorFlipX ? -1 : 1;
  const signY = anchorFlipY ? -1 : 1;

  const buildingRectLocal = child.rects[0];
  const pathRectLocal = child.rects[1];
  // Apply variant flip first (child.local → subtree.local).
  const buildingFlipped = applyFlips(buildingRectLocal, vFlipX, vFlipY);
  const pathFlipped = applyFlips(pathRectLocal, vFlipX, vFlipY);

  // Stem offset in subtree.local frame.
  const stemAlong = placed.stem;
  const stemX = orientation === StreetAxis.X ? stemAlong : 0;
  const stemY = orientation === StreetAxis.Y ? stemAlong : 0;

  // Apply cumulative anchor flip + parent origin to translate to world.
  const buildingWorldX = originX + signX * (buildingFlipped.x + stemX);
  const buildingWorldY = originY + signY * (buildingFlipped.y + stemY);
  const pathWorldX = originX + signX * (pathFlipped.x + stemX);
  const pathWorldY = originY + signY * (pathFlipped.y + stemY);

  // Building orient is in WORLD frame: it describes which way the door
  // faces. Side+mirror determine the natural orient in subtree.local; the
  // cumulative anchor flip must also be applied so the orient is correct
  // after the subtree is mapped to world.
  let orient: BuildingOrient;
  if (orientation === StreetAxis.X) {
    orient = placed.side === 0 ? BuildingOrient.South : BuildingOrient.North;
  } else {
    orient = placed.side === 0 ? BuildingOrient.East : BuildingOrient.West;
  }
  if (placed.mirror) orient = _mirrorOrient(orient, vFlipX, vFlipY);
  if (anchorFlipX || anchorFlipY) {
    orient = _mirrorOrient(orient, anchorFlipX, anchorFlipY);
  }

  const dim = getBuildingDimensions(child.file, layout.lineStats, layout.byteStats);
  const buildingRect: Building = {
    x: buildingWorldX,
    y: buildingWorldY,
    w: buildingFlipped.w,
    d: buildingFlipped.d,
    h: dim.h,
    floors: dim.floors,
    file: child.file as unknown as Building['file'],
    color: null as unknown as string,
    orient,
  };
  const pathRect: BuildingPath = {
    x: pathWorldX,
    y: pathWorldY,
    w: pathFlipped.w,
    d: pathFlipped.d,
    file: child.file as unknown as BuildingPath['file'],
  };
  layout.buildings.push(buildingRect);
  layout.paths.push(pathRect);
  occupancy.insert({
    minX: buildingWorldX - buildingFlipped.w / 2,
    minY: buildingWorldY - buildingFlipped.d / 2,
    maxX: buildingWorldX + buildingFlipped.w / 2,
    maxY: buildingWorldY + buildingFlipped.d / 2,
    kind: 'building',
    ref: buildingRect,
  });
  occupancy.insert({
    minX: pathWorldX - pathFlipped.w / 2,
    minY: pathWorldY - pathFlipped.d / 2,
    maxX: pathWorldX + pathFlipped.w / 2,
    maxY: pathWorldY + pathFlipped.d / 2,
    kind: 'path',
    ref: pathRect,
  });
}

type ManifestLike = { tree?: DirLike } | DirLike;

// layoutCityV4 — Tier B public entry. Same shape as layoutCity from v3.
export function layoutCityV4(manifest: ManifestLike): CityLayout {
  return _layoutCityV4Internal(manifest, undefined).layout;
}

// layoutCityV4WithTrace — same layout output, plus a StemPlacementTrace
// recording each placeChild decision for the "Diagnose stem placement"
// debug button.
export function layoutCityV4WithTrace(
  manifest: ManifestLike,
): { layout: CityLayout; trace: StemPlacementTrace } {
  return _layoutCityV4Internal(manifest, { placements: [] });
}

function _layoutCityV4Internal(
  manifest: ManifestLike,
  trace: StemPlacementTrace | undefined,
): { layout: CityLayout; trace: StemPlacementTrace } {
  const tree = ((manifest as { tree?: DirLike }).tree ?? manifest) as DirLike;
  const result: CityLayout = {
    streets: [],
    buildings: [],
    paths: [],
    lineStats: { min: 1, max: 1 },
    byteStats: { min: 1, max: 1 },
  };

  const stats = computeFileStats(tree);
  result.lineStats = stats.lines;
  result.byteStats = stats.bytes;

  const occupancy = new WorldOccupancy();
  const subtree = _preComputeDirV4(tree, undefined, stats.lines, stats.bytes, StreetAxis.X);
  // Root has no anchor flip (its local frame IS world).
  _commitDirV4(subtree, 0, 0, undefined, undefined, false, false, occupancy, result, trace);

  for (const street of result.streets) {
    if ((street.dir as unknown) === (tree as unknown)) {
      street.isRoot = true;
      break;
    }
  }

  _markJoinSides(result.streets);

  return { layout: result, trace: trace ?? { placements: [] } };
}
