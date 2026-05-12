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
// param is supplied to findSmallestValidStem / placeChild / _layoutDirV4.

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
  | { kind: 'file'; file: FileLike; rects: Rect[] }
  | { kind: 'subdir'; subtree: PreComputedSubtree };

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

      const lower = gMinAlong - alongMax0 - p.childGap;
      const upper = gMaxAlong - alongMin0 + p.childGap;
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
  priorStem: number;
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
    const stem = findSmallestValidStem(
      {
        childRects: p.childRects,
        parentOrient: p.parentOrient,
        side,
        mirror,
        parentOriginX: p.parentOriginX,
        parentOriginY: p.parentOriginY,
        priorStem: p.priorStem,
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

// SubtreeResult — what each _layoutDirV4 call accumulates in its local frame.
// Streets, buildings, and paths use the existing CityLayout shape (kind+ref
// payload preserved). alongReach is the join-strip half-width the parent
// street physically has to cover at the parent boundary.
interface SubtreeResult {
  alongReach: number;
  streets: Street[];
  buildings: Building[];
  paths: BuildingPath[];
}

// _layoutDirV4(dir, originX, originY, orientation, result, parentStreetWidth,
//             lineStats, byteStats, occupancy)
//   → fills `result` with this subtree's content in WORLD frame (relative to
//     the passed origin). Inserts every committed rect into `occupancy`.
//
// Reproduces v3 _layoutDir's geometry (padding chain, file rect math,
// T-junction translation) exactly; the only logic that changes is the
// placement decision (placeChild against the local WorldOccupancy passed in).
//
// occupancy semantics:
//   At the TOP-LEVEL call, occupancy is the GLOBAL occupancy. Children placed
//   directly under root see each other through it.
//   At a SUBDIR call (from the subdir branch below), occupancy is a fresh
//   LOCAL occupancy so the subdir's grandchildren only see each other within
//   the subtree during pre-compute. After the recursion returns, the caller
//   translates the subtree to world coords and inserts everything into the
//   ACTUAL global occupancy.
function _layoutDirV4(
  dir: DirLike,
  originX: number,
  originY: number,
  orientation: StreetAxis,
  result: SubtreeResult,
  parentStreetWidth: number | undefined,
  lineStats: RangeStat,
  byteStats: RangeStat,
  occupancy: WorldOccupancy,
  trace?: StemPlacementTrace,
): void {
  // ----- Tunables (one .get() per call, matching v3 pattern) -----
  const streetLayout = STREET_LAYOUT.get();
  const childGap = streetLayout.CHILD_GAP;
  const parentJoinPad = streetLayout.PARENT_JOIN_PAD;
  const rootEndPad = streetLayout.ROOT_END_PAD;
  const bldgDims = BUILDING_DIMENSIONS.get();
  const bldgPathLength = bldgDims.PATH_LENGTH;
  const pathWidthFrac = bldgDims.PATH_WIDTH_FRAC;

  // ----- Padding chain (copied from v3 layout.ts lines 740-767) -----
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
  //   - Along this dir's PERP axis: spans ±PHANTOM_FAR (parent's length is
  //     unknown during pre-compute; use a generous bound — practical perp
  //     extents are O(tree_depth × max_street_width), well below 1e9).
  //
  // Skipped at the root call (parentStreetWidth undefined), where no parent
  // body exists. -----
  if (parentStreetWidth !== undefined && parentStreetWidth > 0) {
    const halfP = parentStreetWidth / 2;
    const PHANTOM_FAR = 1e9;
    const phantomMinX = orientation === StreetAxis.X ? -halfP : -PHANTOM_FAR;
    const phantomMaxX = orientation === StreetAxis.X ? +halfP : +PHANTOM_FAR;
    const phantomMinY = orientation === StreetAxis.Y ? -halfP : -PHANTOM_FAR;
    const phantomMaxY = orientation === StreetAxis.Y ? +halfP : +PHANTOM_FAR;
    occupancy.insert({
      minX: phantomMinX,
      minY: phantomMinY,
      maxX: phantomMaxX,
      maxY: phantomMaxY,
      kind: 'street',
      // Phantom ref — never read by findSmallestValidStem or the result
      // arrays (the phantom lives only in the local occupancy and never
      // appears in CityLayout). Typed as Street to satisfy WorldRect.ref.
      ref: {
        x: 0, y: 0, length: 0, width: parentStreetWidth,
        orientation: orientation === StreetAxis.X ? StreetAxis.Y : StreetAxis.X,
        label: '__phantom_parent_body__',
        dir: null as unknown as Street['dir'],
      } as Street,
    });
  }

  // ----- Sort children alphabetically (copied from v3 lines 770-773) -----
  const children = ((dir.children || []) as TreeLike[])
    .filter((c) => c.type === NodeKind.File || c.type === NodeKind.Directory)
    .slice()
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  const subOrient = orientation === StreetAxis.X ? StreetAxis.Y : StreetAxis.X;

  // ----- Place children one by one -----
  // priorStem tracks the previous placement's chosen stem (alphabetical-
  // monotonic constraint: each child's stem must be ≥ priorStem).
  let priorStem = originPad;
  // maxBoundaryAlong tracks the far edge of the last-placed child, used to
  // size the own street at the end.
  let maxBoundaryAlong = originPad;

  for (const child of children) {
    if (child.type === NodeKind.File) {
      // ----- File leaf: compute rects in child-local frame -----
      // Copied identically from v3 layout.ts ~lines 894-926.
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

      // Child-local rects: building + path. Used by placeChild for variant
      // evaluation (collision testing against occupancy).
      const childRects: Rect[] = [
        { x: bx, y: by, w: bw, d: bd },
        { x: px, y: py, w: pw, d: pd },
      ];

      // Pick the best (side, mirror, stem) variant.
      const variants: VariantTrace[] = [];
      const placed = placeChild(
        {
          childRects,
          parentOrient: orientation,
          parentOriginX: originX,
          parentOriginY: originY,
          priorStem,
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
        trace.placements.push({
          childKind: 'file',
          childLabel: child.name ?? '?',
          childPath: String((child as DirLike).path ?? ''),
          parentPath: dir.path ?? '',
          baseline: Math.max(priorStem, originPad),
          priorStem,
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
      occupancy.insert({
        minX: buildingWorldX - buildingLocal.w / 2,
        minY: buildingWorldY - buildingLocal.d / 2,
        maxX: buildingWorldX + buildingLocal.w / 2,
        maxY: buildingWorldY + buildingLocal.d / 2,
        kind: 'building',
        ref: buildingRect,
      });
      occupancy.insert({
        minX: pathWorldX - pathLocal.w / 2,
        minY: pathWorldY - pathLocal.d / 2,
        maxX: pathWorldX + pathLocal.w / 2,
        maxY: pathWorldY + pathLocal.d / 2,
        kind: 'path',
        ref: pathRect,
      });

      priorStem = placed.stem;
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
          childRects,
          parentOrient: orientation,
          parentOriginX: originX,
          parentOriginY: originY,
          priorStem,
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
        trace.placements.push({
          childKind: 'dir',
          childLabel: child.name ?? '?',
          childPath: String((child as DirLike).path ?? ''),
          parentPath: dir.path ?? '',
          baseline: Math.max(priorStem, originPad),
          priorStem,
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
        occupancy.insert({
          minX: worldStreet.x - halfAlongX,
          minY: worldStreet.y - halfAlongY,
          maxX: worldStreet.x + halfAlongX,
          maxY: worldStreet.y + halfAlongY,
          kind: 'street',
          ref: worldStreet,
        });
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
        occupancy.insert({
          minX: worldBuilding.x - b.w / 2,
          minY: worldBuilding.y - b.d / 2,
          maxX: worldBuilding.x + b.w / 2,
          maxY: worldBuilding.y + b.d / 2,
          kind: 'building',
          ref: worldBuilding,
        });
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
        occupancy.insert({
          minX: worldPath.x - p.w / 2,
          minY: worldPath.y - p.d / 2,
          maxX: worldPath.x + p.w / 2,
          maxY: worldPath.y + p.d / 2,
          kind: 'path',
          ref: worldPath,
        });
      }

      priorStem = placed.stem;
      const boundaryHigh = placed.stem + childResult.alongReach;
      if (boundaryHigh > maxBoundaryAlong) maxBoundaryAlong = boundaryHigh;
    }
  }

  // ----- Emit own main street (copied from v3 ~lines 1387-1405) -----
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
    kind: 'street',
    ref: ownStreet,
  });
}

// _preComputeDirV4 — bottom-up pass that produces a PreComputedSubtree
// describing this dir's road geometry and per-child rect lists. Uses a
// LOCAL occupancy for collision checks to determine road length. Does NOT
// insert anything into a global occupancy; commit (_commitDirV4) does that.
//
// Mirrors _layoutDirV4's algorithm but discards the final positions —
// commit re-computes them against the global occupancy.
export function _preComputeDirV4(
  dir: DirLike,
  parentStreetWidth: number | undefined,
  lineStats: RangeStat,
  byteStats: RangeStat,
  orientation: StreetAxis,
): PreComputedSubtree {
  // ----- Tunables -----
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

  // ----- Local occupancy with phantom-parent-body, same as V4 -----
  const localOccupancy = new WorldOccupancy();
  if (parentStreetWidth !== undefined && parentStreetWidth > 0) {
    const halfP = parentStreetWidth / 2;
    const PHANTOM_FAR = 1e9;
    const phantomMinX = orientation === StreetAxis.X ? -halfP : -PHANTOM_FAR;
    const phantomMaxX = orientation === StreetAxis.X ? +halfP : +PHANTOM_FAR;
    const phantomMinY = orientation === StreetAxis.Y ? -halfP : -PHANTOM_FAR;
    const phantomMaxY = orientation === StreetAxis.Y ? +halfP : +PHANTOM_FAR;
    localOccupancy.insert({
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

  // ----- Walk children, building PreComputedChild[] and tracking road length -----
  const result: PreComputedChild[] = [];
  let priorStem = originPad;
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

      result.push({ kind: 'file', file: child as FileLike, rects: childRects });
      priorStem = placed.stem;
      const boundaryHigh = placed.stem + along / 2;
      if (boundaryHigh > maxBoundaryAlong) maxBoundaryAlong = boundaryHigh;
    } else {
      // Subdir: recurse, then advisory-place its road in local occupancy.
      const subtree = _preComputeDirV4(child as DirLike, myStreetWidth, lineStats, byteStats, subOrient);

      // For advisory placement, use just the subdir's road rect (matches the
      // deferred-commit approach we'll use at commit time too).
      const subChildRects = _flattenSubtreeRects(subtree);
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

      // Insert subdir's advisory road footprint into local occupancy.
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

      result.push({ kind: 'subdir', subtree });
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
  const subResult: SubtreeResult = {
    alongReach: 0,
    streets: result.streets,
    buildings: result.buildings,
    paths: result.paths,
  };
  _layoutDirV4(
    tree, 0, 0, StreetAxis.X,
    subResult, undefined,
    stats.lines, stats.bytes,
    occupancy, trace,
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
