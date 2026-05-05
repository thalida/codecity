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

  // Compute paths from each building's door to the adjacent street.
  // Length bridges the building-to-sidewalk gap (absolute units); width
  // is a per-building fraction of that building's own width, so big
  // buildings get proportionally chunkier paths. Same per-building
  // width also drives door size — see engine.js.
  const dimsCfg = BUILDING_DIMENSIONS.get();
  const pathLength = dimsCfg.PATH_LENGTH;
  const pathWidthFrac = dimsCfg.PATH_WIDTH_FRAC;
  for (const bForPath of result.buildings) {
    const pathWidth = bForPath.w * pathWidthFrac;
    const path = _pathForBuilding(bForPath, pathWidth, pathLength);
    if (path) {
      // Stamp the building's file so the renderer can match each path
      // mesh back to its parent street's sidewalk for color updates.
      const bp: BuildingPath = { ...path, file: bForPath.file };
      result.paths.push(bp);
    }
  }

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
// _pathForBuilding(building, pathWidth, pathLength) -> path | null
//
// Returns a thin sidewalk-colored strip connecting the building's door (on its
// front face) to the adjacent street's sidewalk. `pathLength` is
// BUILDING_DIMENSIONS.PATH_LENGTH (bridges the gap between building face and
// street edge); `pathWidth` is the caller-provided per-building width
// (= building.w × PATH_WIDTH_FRAC; also drives door size — see engine.js).
// -----------------------------------------------------------------------------
function _pathForBuilding(
  b: Building,
  pathWidth: number,
  pathLength: number
): { x: number; y: number; w: number; d: number } | null {
  if (b.orient === BuildingOrient.South) {
    return {
      x: b.x,
      y: b.y + b.d / 2 + pathLength / 2,
      w: pathWidth,
      d: pathLength,
    };
  }
  if (b.orient === BuildingOrient.East) {
    return {
      x: b.x + b.w / 2 + pathLength / 2,
      y: b.y,
      w: pathLength,
      d: pathWidth,
    };
  }
  if (b.orient === BuildingOrient.North) {
    return {
      x: b.x,
      y: b.y - b.d / 2 - pathLength / 2,
      w: pathWidth,
      d: pathLength,
    };
  }
  if (b.orient === BuildingOrient.West) {
    return {
      x: b.x - b.w / 2 - pathLength / 2,
      y: b.y,
      w: pathLength,
      d: pathWidth,
    };
  }
  return null;
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
  result: { streets: Street[]; buildings: Building[]; paths?: BuildingPath[] },
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
  const bldgPathLength = BUILDING_DIMENSIONS.get().PATH_LENGTH;

  // Widths — this street's visual width comes from its descendants count, and
  // end-padding depends on the PARENT street's width so children don't cross
  // the parent intersection.
  const myStreetWidth = _streetWidthForDir(dir);
  const bldgOffset = myStreetWidth / 2 + bldgPathLength;

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
    .filter((c) => {
      return c.type === NodeKind.File || c.type === NodeKind.Directory;
    })
    .slice()
    .sort((a, b) => {
      return (a.name || '').localeCompare(b.name || '');
    });

  const subOrient = orientation === StreetAxis.X ? StreetAxis.Y : StreetAxis.X;

  // ---- Pre-compute each subdir's layout in its own local frame ------------
  // We need each subdir's bbox BEFORE positioning it, so siblings can be
  // packed without overlap. Local layout has subdir's street at (0,0) extending
  // in +subOrient. Pass myStreetWidth down so the child's own endPad respects
  // this (parent) street's footprint.
  const subLayouts: Record<
    number,
    {
      result: { streets: Street[]; buildings: Building[] };
      bbox: { minX: number; maxX: number; minY: number; maxY: number };
    }
  > = {};
  for (let i = 0; i < children.length; i++) {
    if (children[i].type === NodeKind.Directory) {
      const localResult: { streets: Street[]; buildings: Building[] } = {
        streets: [],
        buildings: [],
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
      subLayouts[i] = {
        result: localResult,
        bbox: _computeBbox(localResult),
      };
    }
  }

  // ---- Walk children, packing per-side while preserving alphabetical order
  //
  //   - cursor[0] / cursor[1]   — end position already occupied on each side.
  //   - alphaCursor             — furthest end reached by ANY child so far;
  //                                the next child must start at or after it
  //                                so intersections + buildings stay in
  //                                alphabetical order along the road.
  //   - subdirCount             — used to alternate subdir sides.
  //   - preferredFileSide       — files default to the side OPPOSITE the
  //                                most-recent subdir, and subsequent files
  //                                stay on that side so they pack tight
  //                                (no forced zig-zagging).
  const cursor = [originPad, originPad];
  let alphaCursor = originPad;
  let subdirCount = 0;
  let preferredFileSide = 0;
  const fileBuildings: Building[] = [];

  for (let ci = 0; ci < children.length; ci++) {
    const child = children[ci];

    if (child.type === NodeKind.File) {
      const dim = getBuildingDimensions(child as FileLike, lineStats, byteStats);
      const alongStreet = dim.w;
      const perpStreet = dim.d;
      const sideIdx = preferredFileSide;

      // Anchor position: no earlier than this side's own cursor, and no
      // earlier than the global alphaCursor (so we stay after prior items).
      const startPos = Math.max(cursor[sideIdx], alphaCursor);
      const centerPos = startPos + alongStreet / 2;

      let bx, by, bldgW, bldgD, orient;
      if (orientation === StreetAxis.X) {
        bx = originX + centerPos;
        if (sideIdx === 0) {
          by = originY - bldgOffset - perpStreet / 2;
          orient = BuildingOrient.South;
        } else {
          by = originY + bldgOffset + perpStreet / 2;
          orient = BuildingOrient.North;
        }
        bldgW = alongStreet;
        bldgD = perpStreet;
      } else {
        by = originY + centerPos;
        if (sideIdx === 0) {
          bx = originX - bldgOffset - perpStreet / 2;
          orient = BuildingOrient.East;
        } else {
          bx = originX + bldgOffset + perpStreet / 2;
          orient = BuildingOrient.West;
        }
        bldgW = perpStreet;
        bldgD = alongStreet;
      }

      fileBuildings.push({
        x: bx,
        y: by,
        w: bldgW,
        d: bldgD,
        h: dim.h,
        floors: dim.floors,
        file: child as unknown as Building['file'],
        // color is filled in by cityScene.applyManifest (via getBuildingColor)
        // before any mesh is created. Layout itself never reads it.
        color: null as unknown as string,
        orient,
      });

      cursor[sideIdx] = startPos + alongStreet + childGap;
      if (cursor[sideIdx] > alphaCursor) alphaCursor = cursor[sideIdx];
    } else {
      // ---- Subdir branch ----
      const sl = subLayouts[ci];

      let widthLow, widthHigh;
      if (orientation === StreetAxis.X) {
        widthLow = sl.bbox.minX;
        widthHigh = sl.bbox.maxX;
      } else {
        widthLow = sl.bbox.minY;
        widthHigh = sl.bbox.maxY;
      }

      // Subdirs alternate sides based on how many subdirs we've placed.
      const subSide = subdirCount % 2;
      const subStart = Math.max(cursor[subSide], alphaCursor);
      const subAnchorOffset = subStart + -widthLow;

      const negateY = orientation === StreetAxis.X && subSide === 0;
      const negateX = orientation === StreetAxis.Y && subSide === 0;

      let subAnchorX, subAnchorY;
      if (orientation === StreetAxis.X) {
        subAnchorX = originX + subAnchorOffset;
        subAnchorY = originY;
      } else {
        subAnchorX = originX;
        subAnchorY = originY + subAnchorOffset;
      }

      for (let ssi = 0; ssi < sl.result.streets.length; ssi++) {
        const s = sl.result.streets[ssi];
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
      for (let sbi = 0; sbi < sl.result.buildings.length; sbi++) {
        const b = sl.result.buildings[sbi];
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

      const subEnd = subStart + (widthHigh - widthLow) + childGap;
      cursor[subSide] = subEnd;
      if (subEnd > alphaCursor) alphaCursor = subEnd;

      // Files that come after a subdir flow onto the OPPOSITE side so they
      // don't get stuck sharing space with the subdir's perpendicular street.
      preferredFileSide = 1 - subSide;
      subdirCount++;
    }
  }

  // Trim the trailing childGap added by the last child, then pad the end.
  let maxCursor = Math.max(cursor[0], cursor[1]);
  if (maxCursor > endPad) maxCursor -= childGap;
  maxCursor += endPad;

  // ---- Compute street length and add street ------------------------------
  const streetLength = Math.max(maxCursor, originPad + endPad);

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

  for (let bi2 = 0; bi2 < fileBuildings.length; bi2++) {
    result.buildings.push(fileBuildings[bi2]);
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
