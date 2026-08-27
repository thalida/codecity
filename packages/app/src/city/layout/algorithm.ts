// city/layout/algorithm.ts — street/building placement. Pure data, no DOM or
// Three.js. A global-occupancy packer: each directory becomes a street, its
// files line the sides, its subdirectories branch off perpendicular, and each
// placement takes the smallest stem that clears everything already placed.

import { STREET_LAYOUT } from '@/state/settings/fields/streets';
import { BUILDING_DIMENSIONS } from '@/state/settings/fields/buildings';
import { GEM_SIZING } from '@/state/settings/fields/gem';
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
import {
  Building,
  BuildingOrient,
  CityLayout,
  JoinSide,
  NodeKind,
  RangeStat,
  RepoStats,
  Street,
  StreetAxis,
} from '@codecity/city';

// Dead space past the gem at the root street's origin end, in gem diameters.
// Fixed, not user-tunable.
const GEM_CLEARANCE_AS_GEM_WIDTH_FRAC = 1.0;

interface ManifestLike {
  tree?: DirLike;
  stats?: RepoStats;
  [k: string]: unknown;
}

// What each _layoutDir call accumulates in its local frame. alongReach is the
// join-strip half-width the parent street has to cover at the boundary.
interface SubtreeResult {
  alongReach: number;
  streets: Street[];
  buildings: Building[];
}

// A dir's final road length + perpendicular extent, in its own frame. Seeds a
// child's phantom, so a grandchild can't land on a since-grown ancestor.
export interface DirReaches {
  /** Road length in this dir's along axis: max(side0 far-edge, side1 far-edge) + endPad. */
  alongReach: number;
  /** Max distance from this dir's centerline along its perp axis. */
  perpReach: number;
}

// Bottom-up walk of every dir's reaches, memoized so each is visited once. A
// tight UPPER bound: over-sizing is invisible, under-sizing brings the bug back.
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

  // Far edge of the children placed on each side; -Infinity means none yet.
  // phantomBumpStem is the floor the grandparent body's phantom forces.
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
      // A perpendicular subdir spans 2*perpReach along the parent's axis (both
      // sides of its road) and alongReach across it (join to end, one-sided).
      alongContrib = 2 * sub.perpReach;
      perpContrib = sub.alongReach;
      myGap = streetGap;
    }
    // Pick the side with smaller far edge (matches placeChild's smallest-stem
    // tiebreaking with empty occupancy).
    const side = sideFarEdge[0] <= sideFarEdge[1] ? 0 : 1;
    if (sideFarEdge[side] === -Infinity) {
      // The first child clears the parent's street BODY, not a sibling: the
      // branch-join spacing is originPad's, so the sibling gap does not apply.
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

// A phantom rect covering the parent street's body, so children's stems clear
// its perp footprint. Spans the parent's final road length (PHANTOM_FAR if unknown).
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

// Fills `result` with this subtree in WORLD frame and inserts every committed
// rect into `occupancy` — global at the top level, subtree-local in recursion.
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
  /** Parent's FINAL road length, so the phantom covers its whole body rather
   *  than the extent at this recursion's start. Undefined at the top level. */
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
  // Off the gem's own diameter, so the dead space scales with it. Same
  // MIN_RADIUS floor the gem mesh uses, or a narrow root street under-reserves.
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

  // priorStems is the alphabetical-monotonic floor PER SIDE: opposite-side
  // neighbours don't collide, so neither side pushes the other along.
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

      // Side 0 is the flipped perp position, so the door points back toward
      // the parent street.
      let orient: BuildingOrient;
      if (orientation === StreetAxis.X) {
        orient = placed.side === 0 ? BuildingOrient.South : BuildingOrient.North;
      } else {
        orient = placed.side === 0 ? BuildingOrient.East : BuildingOrient.West;
      }
      // Defensive: a file's rects are mirror-invariant, so placeChild never
      // picks mirror=true for one (its tiebreak prefers non-mirror).
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
      // This dir's own alongReach is exactly the perp-axis bound the child's
      // phantom has to cover.
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

      // The rects placeChild evaluates for variants, in the parent's frame.
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

      // subAnchor is the child's origin in the parent's world frame: shifted
      // by stem along the along-axis, unchanged across it.
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

// Walks the tree into a street network in world coordinates. `color` starts
// null: the renderer calls getBuildingColor before drawing.
/** @param onPlaced Called once per node as the packer commits it, so a caller
 *  that knows the node count can turn the pack into a percent. */
export function layoutCity(manifest: ManifestLike | DirLike, onPlaced?: () => void): CityLayout {
  return _layoutCityInternal(manifest, undefined, onPlaced).layout;
}

// Same layout output, plus the per-placeChild trace behind the "Diagnose stem
// placement" debug button.
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

// For every non-root street, which end JOINS: the renderer flattens that one
// and rounds the open one. Read off distance to the parent's centerline.

// The transient `joinSide` the Street type doesn't model, widened locally.
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

    // The child's joining end sits ON the parent's centerline, a constant of
    // the parent's cross-axis — which is the child's own LENGTH axis.
    const parentCrossAxis = parent.orientation === StreetAxis.X ? parent.y : parent.x;
    const dLow = Math.abs(lowEnd - parentCrossAxis);
    const dHigh = Math.abs(highEnd - parentCrossAxis);
    s2.joinSide = dLow < dHigh ? JoinSide.Low : JoinSide.High;
  }
}

// A mirrored subtree flips each building's door-facing orient too, or the
// building lands across its own street with the door pointing away.
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
