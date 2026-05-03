// layout.js — Street/building placement algorithm. Pure data output, no DOM or Three.js.
//   Building: { x, y, w, d, h, color, file, orient }
//   Street:   { x, y, w, d, label, dir }
//
// All tunables come from the nanostores under src/config/. Tests that
// need different values mutate the stores via .setKey() in setup +
// restore in teardown — keeps the production callsites argument-free.

import {
  STREET_LAYOUT,
  STREET_TIERS,
  BUILDING_DIMENSIONS,
  GEM_SIZING
} from '../config/index.js';
import { NODE_KIND, BUILDING_ORIENT, STREET_AXIS } from '../constants.js';
import { parentDirPath } from './path.js';

// getStreetWidth(count, tiers?) -> number
//
// Given a descendant count and (optionally) a tier list, return the
// world-unit street width. The tier list defaults to STREET_TIERS.get().
// Each tier entry is { min_descendants, width }. Walk the list and pick
// the tier with the highest min_descendants that `count` meets. The last
// tier (largest min_descendants) acts as the catch-all for big directories.
export function getStreetWidth(count, tiers) {
  var arr = (tiers && tiers.length) ? tiers : STREET_TIERS.get();
  var chosen = arr[0].width;
  for (var i = 0; i < arr.length; i++) {
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
export function computeFileStats(tree) {
  var minLines = Infinity, maxLines = -Infinity;
  var minBytes = Infinity, maxBytes = -Infinity;
  function walk(node) {
    if (!node) return;
    if (node.type === NODE_KIND.FILE) {
      if (node.lines && node.lines > 0) {
        if (node.lines < minLines) minLines = node.lines;
        if (node.lines > maxLines) maxLines = node.lines;
      }
      if (node.size && node.size > 0) {
        if (node.size < minBytes) minBytes = node.size;
        if (node.size > maxBytes) maxBytes = node.size;
      }
    }
    if (node.children) {
      for (var i = 0; i < node.children.length; i++) walk(node.children[i]);
    }
  }
  walk(tree);
  return {
    lines: minLines === Infinity ? { min: 1, max: 1 } : { min: minLines, max: maxLines },
    bytes: minBytes === Infinity ? { min: 1, max: 1 } : { min: minBytes, max: maxBytes }
  };
}

// computeLineStats(tree) — kept for back-compat with tests that only need
// the line-count range. New callers should use computeFileStats.
export function computeLineStats(tree) {
  return computeFileStats(tree).lines;
}


// getBuildingDimensions(file, lineStats?, byteStats?) -> { w, d, h, floors }
//
// Floors and width are BOTH project-relative: the smallest file lands at
// MIN_*, the largest at MAX_*, everything else interpolated. Floors uses
// sqrt to spread the bottom of the range while compressing the long tail;
// width uses log (file sizes span many orders of magnitude). Without a
// stats object, the corresponding dimension falls back to MIN_*.
export function getBuildingDimensions(file, lineStats, byteStats) {
  var dims = BUILDING_DIMENSIONS.get();
  var maxFloorsCap = (dims.MAX_FLOORS != null) ? dims.MAX_FLOORS : 30;

  // ---- Floors from line count (sqrt-normalized over project range) ----
  var lines = (file.lines && file.lines > 0) ? file.lines : 1;
  var floors = dims.MIN_FLOORS;
  if (lineStats && lineStats.max > lineStats.min) {
    var sMin   = Math.sqrt(lineStats.min);
    var sMax   = Math.sqrt(lineStats.max);
    var sLines = Math.sqrt(lines);
    var tH = (sLines - sMin) / (sMax - sMin);
    if (tH < 0) tH = 0; else if (tH > 1) tH = 1;
    floors = Math.round(dims.MIN_FLOORS + tH * (maxFloorsCap - dims.MIN_FLOORS));
    if (floors < dims.MIN_FLOORS) floors = dims.MIN_FLOORS;
  }
  var height = floors * dims.FLOOR_HEIGHT;

  // ---- Width from byte size (log-normalized over project range) ----
  var bytes = (file.size && file.size > 0) ? file.size : 1;
  var width = dims.MIN_WIDTH;
  if (byteStats && byteStats.max > byteStats.min) {
    var lMin   = Math.log(byteStats.min);
    var lMax   = Math.log(byteStats.max);
    var lBytes = Math.log(bytes);
    var tW = (lBytes - lMin) / (lMax - lMin);
    if (tW < 0) tW = 0; else if (tW > 1) tW = 1;
    width = dims.MIN_WIDTH + tW * (dims.MAX_WIDTH - dims.MIN_WIDTH);
  }

  // Depth == width keeps footprints square so tall thin towers don't
  // become deep slabs.
  return {
    w:      Math.round(width  * 10) / 10,
    d:      Math.round(width  * 10) / 10,
    h:      Math.round(height * 10) / 10,
    floors: floors
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
export function layoutCity(manifest) {
  var tree = manifest.tree || manifest;
  var result = { streets: [], buildings: [], paths: [] };

  // Compute the project's own ranges once and stash on `result` so the
  // recursion below can pass them to every getBuildingDimensions call
  // (and callers can keep them for later use).
  var stats = computeFileStats(tree);
  result.lineStats = stats.lines;
  result.byteStats = stats.bytes;

  _layoutDir(tree, 0, 0, STREET_AXIS.X, result, undefined, stats.lines, stats.bytes);

  // Mark the root-dir street so the renderer can draw a distinct "start of
  // repo" marker at its origin end.
  for (var ri = 0; ri < result.streets.length; ri++) {
    if (result.streets[ri].dir === tree) {
      result.streets[ri].isRoot = true;
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
  // Length bridges the building-to-sidewalk gap; width is a separate
  // designer knob (and also drives door size — see engine.js).
  var dimsCfg    = BUILDING_DIMENSIONS.get();
  var pathLength = dimsCfg.PATH_LENGTH;
  var pathWidth  = dimsCfg.PATH_WIDTH;
  for (var pi = 0; pi < result.buildings.length; pi++) {
    var bForPath = result.buildings[pi];
    var path = _pathForBuilding(bForPath, pathWidth, pathLength);
    if (path) {
      // Stamp the building's file so the renderer can match each path
      // mesh back to its parent street's sidewalk for color updates.
      path.file = bForPath.file;
      result.paths.push(path);
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
function _streetWidthForDir(dir) {
  // Prefer descendants_count (total files+dirs under this node); fall back
  // to direct children_count for shallow trees / older manifests.
  var count = (dir && (dir.descendants_count || dir.children_count)) || 0;
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
function _markJoinSides(streets) {
  var byPath = {};
  for (var i = 0; i < streets.length; i++) {
    var s = streets[i];
    if (s.dir && s.dir.path != null) byPath[s.dir.path] = s;
  }

  for (var j = 0; j < streets.length; j++) {
    var s2 = streets[j];
    if (s2.isRoot) continue;
    if (!s2.dir || s2.dir.path == null) continue;
    var pPath = parentDirPath(s2.dir.path);
    if (pPath == null) continue;
    var parent = byPath[pPath];
    if (!parent) continue;

    // Child's two endpoints along its length axis (in world coords).
    var lowEnd, highEnd;
    if (s2.orientation === STREET_AXIS.X) {
      lowEnd  = s2.x - s2.length / 2;
      highEnd = s2.x + s2.length / 2;
    } else {
      lowEnd  = s2.y - s2.length / 2;
      highEnd = s2.y + s2.length / 2;
    }

    // For a parent + child meeting at a T-intersection, the parent runs
    // perpendicular to the child. The child's joining endpoint sits ON the
    // parent's CENTERLINE, which is a constant value of the parent's
    // CROSS-AXIS (parent.y for x-orient parent, parent.x for y-orient
    // parent). For perpendicular orientations, the parent's cross-axis is
    // the child's LENGTH axis — so we compare each child endpoint along
    // its length axis to the parent's centerline value.
    var parentCrossAxis = (parent.orientation === STREET_AXIS.X) ? parent.y : parent.x;
    var dLow  = Math.abs(lowEnd  - parentCrossAxis);
    var dHigh = Math.abs(highEnd - parentCrossAxis);
    s2.joinSide = (dLow < dHigh) ? 'low' : 'high';
  }
}


// -----------------------------------------------------------------------------
// _pathForBuilding(building, pathWidth, pathLength) -> path | null
//
// Returns a thin sidewalk-colored strip connecting the building's door (on its
// front face) to the adjacent street's sidewalk. `pathLength` is
// BUILDING_DIMENSIONS.PATH_LENGTH (bridges the gap between building face and
// street edge); `pathWidth` is BUILDING_DIMENSIONS.PATH_WIDTH (also drives
// door size — see engine.js).
// -----------------------------------------------------------------------------
function _pathForBuilding(b, pathWidth, pathLength) {
  if (b.orient === BUILDING_ORIENT.SOUTH) {
    return {
      x: b.x,
      y: b.y + b.d / 2 + pathLength / 2,
      w: pathWidth,
      d: pathLength
    };
  }
  if (b.orient === BUILDING_ORIENT.EAST) {
    return {
      x: b.x + b.w / 2 + pathLength / 2,
      y: b.y,
      w: pathLength,
      d: pathWidth
    };
  }
  if (b.orient === BUILDING_ORIENT.NORTH) {
    return {
      x: b.x,
      y: b.y - b.d / 2 - pathLength / 2,
      w: pathWidth,
      d: pathLength
    };
  }
  if (b.orient === BUILDING_ORIENT.WEST) {
    return {
      x: b.x - b.w / 2 - pathLength / 2,
      y: b.y,
      w: pathLength,
      d: pathWidth
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
function _layoutDir(dir, originX, originY, orientation, result, parentStreetWidth, lineStats, byteStats) {
  // User-tunable gaps. Read fresh from the stores each call so tests /
  // runtime mutations take effect without reseating the recursion.
  // Street-packing gaps live in STREET_LAYOUT; the building-to-sidewalk
  // gap belongs to BUILDING_DIMENSIONS (it's a building-side concept).
  var streetLayout    = STREET_LAYOUT.get();
  var childGap        = streetLayout.CHILD_GAP;
  var parentJoinPad   = streetLayout.PARENT_JOIN_PAD;
  var rootEndPad      = streetLayout.ROOT_END_PAD;
  var bldgPathLength  = BUILDING_DIMENSIONS.get().PATH_LENGTH;

  // Widths — this street's visual width comes from its descendants count, and
  // end-padding depends on the PARENT street's width so children don't cross
  // the parent intersection.
  var myStreetWidth = _streetWidthForDir(dir);
  var bldgOffset    = myStreetWidth / 2 + bldgPathLength;

  // The street's rounded cap takes up streetWidth/2 of the length at the
  // OPEN end. To keep the last building (and its path connector) clear
  // of the curve, the open-end pad must be at least cap radius + a small
  // buffer (re-using bldgPathLength so the buffer matches the building↔
  // sidewalk gap visually). Joining ends are flat — they don't need this.
  var openEndPad     = myStreetWidth / 2 + bldgPathLength;
  var joinEndBaseline = parentStreetWidth
    ? parentStreetWidth / 2 + parentJoinPad
    : rootEndPad;

  // endPad is applied at the CHILD'S local-high end (the open end after
  // mirroring/transform). For non-root streets this end is always rounded,
  // so it must clear the cap. For the root, both ends are open / rounded,
  // so we'll also widen its origin-end pad below.
  var endPad = parentStreetWidth
    ? Math.max(joinEndBaseline, openEndPad)
    : Math.max(rootEndPad, openEndPad);

  // Root gets an asymmetric extra pad at its ORIGIN end so the gem has
  // dead space to float over (the cap area doubles as the gem's plaza).
  // Non-root origin ends are FLAT (joining the parent), so they only need
  // joinEndBaseline.
  var gemSizing     = GEM_SIZING.get();
  var gemRadiusFrac = gemSizing.RADIUS_AS_STREET_FRAC;
  var gemClearance  = gemSizing.BUILDING_CLEARANCE;
  var originPad = !parentStreetWidth
    ? Math.max(endPad, myStreetWidth * (0.5 + gemRadiusFrac) + gemClearance)
    : joinEndBaseline;

  // ---- Sort children alphabetically (files + dirs intermingled) -----------
  var children = (dir.children || [])
    .filter(function (c) { return c.type === NODE_KIND.FILE || c.type === NODE_KIND.DIRECTORY; })
    .slice()
    .sort(function (a, b) {
      return (a.name || '').localeCompare(b.name || '');
    });

  var subOrient = (orientation === STREET_AXIS.X) ? STREET_AXIS.Y : STREET_AXIS.X;

  // ---- Pre-compute each subdir's layout in its own local frame ------------
  // We need each subdir's bbox BEFORE positioning it, so siblings can be
  // packed without overlap. Local layout has subdir's street at (0,0) extending
  // in +subOrient. Pass myStreetWidth down so the child's own endPad respects
  // this (parent) street's footprint.
  var subLayouts = {};
  for (var i = 0; i < children.length; i++) {
    if (children[i].type === NODE_KIND.DIRECTORY) {
      var localResult = { streets: [], buildings: [] };
      _layoutDir(children[i], 0, 0, subOrient, localResult, myStreetWidth, lineStats, byteStats);
      subLayouts[i] = {
        result: localResult,
        bbox: _computeBbox(localResult)
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
  var cursor = [originPad, originPad];
  var alphaCursor = originPad;
  var subdirCount = 0;
  var preferredFileSide = 0;
  var fileBuildings = [];

  for (var ci = 0; ci < children.length; ci++) {
    var child = children[ci];

    if (child.type === NODE_KIND.FILE) {
      var dim = getBuildingDimensions(child, lineStats, byteStats);
      var alongStreet = dim.w;
      var perpStreet  = dim.d;
      var sideIdx = preferredFileSide;

      // Anchor position: no earlier than this side's own cursor, and no
      // earlier than the global alphaCursor (so we stay after prior items).
      var startPos = Math.max(cursor[sideIdx], alphaCursor);
      var centerPos = startPos + alongStreet / 2;

      var bx, by, bldgW, bldgD, orient;
      if (orientation === STREET_AXIS.X) {
        bx = originX + centerPos;
        if (sideIdx === 0) {
          by = originY - bldgOffset - perpStreet / 2;
          orient = BUILDING_ORIENT.SOUTH;
        } else {
          by = originY + bldgOffset + perpStreet / 2;
          orient = BUILDING_ORIENT.NORTH;
        }
        bldgW = alongStreet;
        bldgD = perpStreet;
      } else {
        by = originY + centerPos;
        if (sideIdx === 0) {
          bx = originX - bldgOffset - perpStreet / 2;
          orient = BUILDING_ORIENT.EAST;
        } else {
          bx = originX + bldgOffset + perpStreet / 2;
          orient = BUILDING_ORIENT.WEST;
        }
        bldgW = perpStreet;
        bldgD = alongStreet;
      }

      fileBuildings.push({
        x: bx, y: by,
        w: bldgW, d: bldgD, h: dim.h,
        floors: dim.floors,
        file: child,
        color: null,
        orient: orient
      });

      cursor[sideIdx] = startPos + alongStreet + childGap;
      if (cursor[sideIdx] > alphaCursor) alphaCursor = cursor[sideIdx];
    } else {
      // ---- Subdir branch ----
      var sl = subLayouts[ci];

      var widthLow, widthHigh;
      if (orientation === STREET_AXIS.X) {
        widthLow  = sl.bbox.minX;
        widthHigh = sl.bbox.maxX;
      } else {
        widthLow  = sl.bbox.minY;
        widthHigh = sl.bbox.maxY;
      }

      // Subdirs alternate sides based on how many subdirs we've placed.
      var subSide = subdirCount % 2;
      var subStart = Math.max(cursor[subSide], alphaCursor);
      var subAnchorOffset = subStart + (-widthLow);

      var negateY = (orientation === STREET_AXIS.X && subSide === 0);
      var negateX = (orientation === STREET_AXIS.Y && subSide === 0);

      var subAnchorX, subAnchorY;
      if (orientation === STREET_AXIS.X) {
        subAnchorX = originX + subAnchorOffset;
        subAnchorY = originY;
      } else {
        subAnchorX = originX;
        subAnchorY = originY + subAnchorOffset;
      }

      for (var ssi = 0; ssi < sl.result.streets.length; ssi++) {
        var s = sl.result.streets[ssi];
        result.streets.push({
          x: (negateX ? -s.x : s.x) + subAnchorX,
          y: (negateY ? -s.y : s.y) + subAnchorY,
          length: s.length,
          width: s.width,
          orientation: s.orientation,
          label: s.label,
          dir: s.dir
        });
      }
      for (var sbi = 0; sbi < sl.result.buildings.length; sbi++) {
        var b = sl.result.buildings[sbi];
        result.buildings.push({
          x: (negateX ? -b.x : b.x) + subAnchorX,
          y: (negateY ? -b.y : b.y) + subAnchorY,
          w: b.w, d: b.d, h: b.h,
          floors: b.floors,
          file: b.file,
          color: b.color,
          orient: _mirrorOrient(b.orient, negateX, negateY)
        });
      }

      var subEnd = subStart + (widthHigh - widthLow) + childGap;
      cursor[subSide] = subEnd;
      if (subEnd > alphaCursor) alphaCursor = subEnd;

      // Files that come after a subdir flow onto the OPPOSITE side so they
      // don't get stuck sharing space with the subdir's perpendicular street.
      preferredFileSide = 1 - subSide;
      subdirCount++;
    }
  }

  // Trim the trailing childGap added by the last child, then pad the end.
  var maxCursor = Math.max(cursor[0], cursor[1]);
  if (maxCursor > endPad) maxCursor -= childGap;
  maxCursor += endPad;

  // ---- Compute street length and add street ------------------------------
  var streetLength = Math.max(maxCursor, originPad + endPad);

  var streetCenterX = originX;
  var streetCenterY = originY;
  if (orientation === STREET_AXIS.X) {
    streetCenterX = originX + streetLength / 2;
  } else {
    streetCenterY = originY + streetLength / 2;
  }

  result.streets.push({
    x: streetCenterX,
    y: streetCenterY,
    length: streetLength,
    width: myStreetWidth,
    orientation: orientation,
    label: dir.name || '',
    dir: dir
  });

  for (var bi2 = 0; bi2 < fileBuildings.length; bi2++) {
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
function _mirrorOrient(orient, negateX, negateY) {
  if (negateX) {
    if      (orient === BUILDING_ORIENT.EAST) orient = BUILDING_ORIENT.WEST;
    else if (orient === BUILDING_ORIENT.WEST) orient = BUILDING_ORIENT.EAST;
  }
  if (negateY) {
    if      (orient === BUILDING_ORIENT.SOUTH) orient = BUILDING_ORIENT.NORTH;
    else if (orient === BUILDING_ORIENT.NORTH) orient = BUILDING_ORIENT.SOUTH;
  }
  return orient;
}


// -----------------------------------------------------------------------------
// _computeBbox(layout) -> { minX, maxX, minY, maxY }
//
// Computes the axis-aligned bounding box (in world or local coords, depending
// on what the layout is in) covering all streets and buildings.
// -----------------------------------------------------------------------------
function _computeBbox(layout) {
  var minX = Infinity, maxX = -Infinity;
  var minY = Infinity, maxY = -Infinity;

  for (var i = 0; i < layout.streets.length; i++) {
    var s = layout.streets[i];
    var halfL = s.length / 2;
    var halfW = s.width / 2;
    var x1, x2, y1, y2;
    if (s.orientation === STREET_AXIS.X) {
      x1 = s.x - halfL; x2 = s.x + halfL;
      y1 = s.y - halfW; y2 = s.y + halfW;
    } else {
      x1 = s.x - halfW; x2 = s.x + halfW;
      y1 = s.y - halfL; y2 = s.y + halfL;
    }
    if (x1 < minX) minX = x1;
    if (x2 > maxX) maxX = x2;
    if (y1 < minY) minY = y1;
    if (y2 > maxY) maxY = y2;
  }

  for (var j = 0; j < layout.buildings.length; j++) {
    var b = layout.buildings[j];
    var bx1 = b.x - b.w / 2, bx2 = b.x + b.w / 2;
    var by1 = b.y - b.d / 2, by2 = b.y + b.d / 2;
    if (bx1 < minX) minX = bx1;
    if (bx2 > maxX) maxX = bx2;
    if (by1 < minY) minY = by1;
    if (by2 > maxY) maxY = by2;
  }

  if (minX === Infinity) {
    return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  }
  return { minX: minX, maxX: maxX, minY: minY, maxY: maxY };
}


// -----------------------------------------------------------------------------
// sortForRendering(buildings) -> buildings[]
//
// Painter's algorithm: sorts buildings so that those further from the viewer
// (higher x + y sum) are drawn first. Returns a new sorted array.
// -----------------------------------------------------------------------------
export function sortForRendering(buildings) {
  var sorted = buildings.slice();
  sorted.sort(function(a, b) {
    // Ascending: lowest x+y drawn first.
    // In our projection sx=(x-y)*cos30, sy=(x+y)*sin30-z:
    //   Lower x+y = higher on screen (north-west) = behind
    //   Higher x+y = lower on screen (south-east) = in front
    // Painter's: draw behind first (low x+y), in-front last (high x+y).
    return (a.x + a.y) - (b.x + b.y);
  });
  return sorted;
}
