// city/layout/algorithm.ts — Street/building placement algorithm. Pure data output,
// no DOM or Three.js.
//   Building: { x, y, w, d, h, color, file, orient }
//   Street:   { x, y, w, d, label, dir }
//
// All tunables come from the settings stores under state/stores/settings/.
// Tests that need different values set the signals directly in setup +
// restore in teardown — keeps the production callsites argument-free.
//
// Layout works via a global-occupancy packer: each directory becomes a
// street, files line the street as buildings, and subdirectories branch
// off as perpendicular streets. The packer (placeChild /
// findSmallestValidStem / _layoutDir) decides each placement by
// querying a WorldOccupancy structure for the smallest stem offset that
// keeps the new geometry from intersecting anything already placed.

import { STREET_LAYOUT } from '@/state/stores/settings/streets';
import { BUILDING_DIMENSIONS } from '@/state/stores/settings/buildings';
import { GEM_SIZING } from '@/state/stores/settings/gem';
import { BuildingOrient, JoinSide, NodeKind, StreetAxis } from '@/types';
import type { Building, CityLayout, RangeStat, RepoStats, Street } from '@/types';
import { parentDirPath } from '../utils/path';
import { rectOfBuilding, rectOfStreet } from './rect';
import type { Rect } from './rect';
import { WorldOccupancy, WorldRectKind } from './occupancyIndex';
import type { WorldRect } from './occupancyIndex';
import { _profNow, _profEnd, _logLayoutProfile } from './profiling';
import { computeFileStats, getBuildingDimensions, _streetWidthForDir } from './dimensions';
import type { DirLike, FileLike, TreeLike } from './dimensions';
import { applyFlips, computeFlips, placeChild } from './stemSolver';
import type { PlaceChildResult, StemPlacementTrace, VariantTrace } from './stemSolver';

// Dead-space pad past the gem at the root street's origin end, as a multiple of
// the gem's diameter. Fixed, not user-tunable (was in GEM_SIZING but never
// exposed as a control).
const GEM_CLEARANCE_AS_GEM_WIDTH_FRAC = 1.0;

interface ManifestLike {
  tree?: DirLike;
  stats?: RepoStats;
  [k: string]: unknown;
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

// _seedParentPhantom — insert a phantom rect covering the parent street's body
// into this dir's local occupancy, so children's stems clear the parent main
// street's perp footprint. Along this dir's axis it spans ±parentStreetWidth/2
// (the join sits at along=0); along the perp axis it covers the parent's final
// road length (from the estimateDirReaches pre-pass; PHANTOM_FAR when unknown).
function _seedParentPhantom(
  occupancy: WorldOccupancy,
  orientation: StreetAxis,
  parentStreetWidth: number,
  parentFinalAlongReach: number | undefined
): void {
  const halfP = parentStreetWidth / 2;
  const PHANTOM_FAR = 1e9;
  // +1 unit absorbs FP drift between the pre-pass estimate and actual placement.
  const reach = parentFinalAlongReach !== undefined ? parentFinalAlongReach + 1 : PHANTOM_FAR;
  const alongX = orientation === StreetAxis.X;
  occupancy.insert({
    minX: alongX ? -halfP : -reach,
    minY: alongX ? -reach : -halfP,
    maxX: alongX ? halfP : reach,
    maxY: alongX ? reach : halfP,
    kind: WorldRectKind.Street,
    // parentBody marks this as the parent's body, not a sibling, so the
    // sibling-gap logic skips the street gap (join clearance is PARENT_JOIN_PAD).
    parentBody: true,
    // Phantom ref — never read (lives only in local occupancy, never in CityLayout).
    ref: {
      x: 0,
      y: 0,
      length: 0,
      width: parentStreetWidth,
      orientation: alongX ? StreetAxis.Y : StreetAxis.X,
      label: '__phantom_parent_body__',
      dir: null as unknown as Street['dir'],
    } as Street,
  });
}

// _recordPlacement — append one diagnostic record for a placed child to the
// stem-placement trace (debug button only; no effect on layout output).
function _recordPlacement(
  trace: StemPlacementTrace,
  childKind: 'file' | 'dir',
  child: TreeLike,
  parentPath: string,
  placed: PlaceChildResult,
  variants: VariantTrace[],
  priorStems: readonly [number, number],
  originPad: number
): void {
  const chosenIdx = variants.findIndex((v) => v.side === placed.side && v.mirror === placed.mirror);
  if (chosenIdx < 0) {
    throw new Error(
      `[stem-diag] placed variant not found in trace.variants — placeChild invariant broken (side=${placed.side}, mirror=${placed.mirror})`
    );
  }
  const chosenPriorStem = priorStems[placed.side];
  trace.placements.push({
    childKind,
    childLabel: child.name ?? '?',
    childPath: String((child as DirLike).path ?? ''),
    parentPath,
    baseline: Math.max(chosenPriorStem, originPad),
    priorStem: chosenPriorStem,
    originPad,
    chosen: variants[chosenIdx],
    others: variants.filter((_, i) => i !== chosenIdx),
  });
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
  parentFinalAlongReach?: number,
  /** Ticked once per committed child, at every depth — the packer's only
   *  progress signal. See layoutCity. */
  onPlaced?: () => void
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

  // Pre-seed the parent's street body so children clear its perp footprint.
  // Skipped at the root call, where no parent body exists.
  if (parentStreetWidth !== undefined && parentStreetWidth > 0) {
    _seedParentPhantom(occupancy, orientation, parentStreetWidth, parentFinalAlongReach);
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
        _recordPlacement(
          trace,
          'file',
          child,
          dir.path ?? '',
          placed,
          variants,
          priorStems,
          originPad
        );
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
        myReaches?.alongReach,
        onPlaced
      );

      // Build child-local rect list from the subtree result. These are the
      // rects placeChild evaluates for variants (collision testing in the
      // parent's frame).
      const _tCR = _profNow();
      const childRects: Rect[] = [];
      for (const s of childResult.streets) {
        childRects.push(rectOfStreet(s));
      }
      for (const b of childResult.buildings) {
        childRects.push(rectOfBuilding(b));
      }
      _profEnd('commit.childRectsBuild', _tCR);

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
        _recordPlacement(
          trace,
          'dir',
          child,
          dir.path ?? '',
          placed,
          variants,
          priorStems,
          originPad
        );
      }

      // Translate the subtree's contents to world coords and commit. The
      // subAnchor is the child's origin in the parent's world frame: along
      // the parent's along axis we shift by stem; perp axis stays at origin.
      const { flipX, flipY } = computeFlips(orientation, placed.side, placed.mirror);
      const subAnchorX = orientation === StreetAxis.X ? originX + placed.stem : originX;
      const subAnchorY = orientation === StreetAxis.X ? originY : originY + placed.stem;

      const _tCommit = _profNow();
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
      _profEnd('commit.translateInsert', _tCommit);

      priorStems[placed.side] = placed.stem;
      const boundaryHigh = placed.stem + childResult.alongReach;
      if (boundaryHigh > maxBoundaryAlong) maxBoundaryAlong = boundaryHigh;
    }
    // One tick per child, whichever branch placed it. A subdir's own tick comes
    // after its subtree's, so the count only ever climbs.
    onPlaced?.();
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
/** @param onPlaced Called once per node as the packer commits it, so a caller
 *  that knows the node count can turn the pack into a percent. */
export function layoutCity(manifest: ManifestLike | DirLike, onPlaced?: () => void): CityLayout {
  return _layoutCityInternal(manifest, undefined, onPlaced).layout;
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
  trace: StemPlacementTrace | undefined,
  onPlaced?: () => void
): { layout: CityLayout; trace: StemPlacementTrace } {
  const tree = ((manifest as { tree?: DirLike }).tree ?? manifest) as DirLike;
  const result: CityLayout = {
    streets: [],
    buildings: [],
    lineStats: { min: 1, max: 1 },
    byteStats: { min: 1, max: 1 },
  };

  const _tStats = _profNow();
  const repoStats = (manifest as ManifestLike).stats;
  const stats = computeFileStats(repoStats);
  _profEnd('phase.computeFileStats', _tStats);
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
  const _tReaches = _profNow();
  const reachCache = new Map<DirLike, DirReaches>();
  estimateDirReaches(tree, stats.lines, stats.bytes, undefined, reachCache);
  _profEnd('phase.estimateDirReaches', _tReaches);
  const _tPlace = _profNow();
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
    trace,
    undefined,
    onPlaced
  );
  _profEnd('phase.layoutDir', _tPlace);

  for (const street of result.streets) {
    if ((street.dir as unknown) === (tree as unknown)) {
      street.isRoot = true;
      break;
    }
  }

  const _tJoin = _profNow();
  _markJoinSides(result.streets);
  _profEnd('phase.markJoinSides', _tJoin);

  _logLayoutProfile(result);

  return { layout: result, trace: trace ?? { placements: [] } };
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
