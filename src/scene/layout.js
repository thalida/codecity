// layout.js — Street/building placement algorithm. Pure data output, no DOM or Three.js.
//   Building: { x, y, w, d, h, color, file, orient }
//   Street:   { x, y, w, d, label, dir }

// getStreetWidth(count, tiers) -> number
//
// Given a descendant count and the ordered tier list from config.layout.street_tiers,
// return the world-unit street width. Each tier entry is
// { min_descendants, width }. Walk the list and pick the tier with the
// highest min_descendants that `count` meets. The last tier (largest
// min_descendants) acts as the catch-all for big directories.
export function getStreetWidth(count, tiers) {
  var fallback = [
    { min_descendants: 0,  width: 10 },
    { min_descendants: 4,  width: 16 },
    { min_descendants: 9,  width: 24 },
    { min_descendants: 16, width: 36 },
    { min_descendants: 31, width: 52 }
  ];
  var arr = (tiers && tiers.length) ? tiers : fallback;
  var chosen = arr[0].width;
  for (var i = 0; i < arr.length; i++) {
    if (count >= arr[i].min_descendants) chosen = arr[i].width;
  }
  return chosen;
}


// computeLineStats(tree) -> { min, max }
//
// Walks the manifest once and returns the smallest and largest non-zero line
// counts across every file. Compact-mode height computation needs both ends of
// the project's actual range so it can sqrt-normalize files into the
// [min_floors, max_floors] band. Empty tree → { min: 1, max: 1 } (single-file
// fallback so the renderer doesn't divide by zero).
export function computeLineStats(tree) {
  var minLines = Infinity;
  var maxLines = -Infinity;
  function walk(node) {
    if (!node) return;
    if (node.type === 'file' && node.lines && node.lines > 0) {
      if (node.lines < minLines) minLines = node.lines;
      if (node.lines > maxLines) maxLines = node.lines;
    }
    if (node.children) {
      for (var i = 0; i < node.children.length; i++) walk(node.children[i]);
    }
  }
  walk(tree);
  if (minLines === Infinity) return { min: 1, max: 1 };
  return { min: minLines, max: maxLines };
}


// getBuildingDimensions(file, config, lineStats) -> { w, d, h, floors }
//
// Floors are sqrt-normalized across the project's own line-count range:
// the smallest file lands at min_floors, the largest at max_floors,
// everything else distributed by sqrt — visibly spreads the bottom of
// the range while compressing the long tail so a 100k-line file doesn't
// dwarf the rest of the city.
//
// `lineStats` (the project's { min, max } line counts) is required to
// normalize. When it's missing or degenerate (single file / all
// identical), every building lands at min_floors as a safe default.
export function getBuildingDimensions(file, config, lineStats) {
  var bc = config.building;
  var lines = (file.lines && file.lines > 0) ? file.lines : 1;
  var maxFloorsCap = (bc.max_floors != null) ? bc.max_floors : 30;

  var floors = bc.min_floors;
  if (lineStats && lineStats.max > lineStats.min) {
    var sMin   = Math.sqrt(lineStats.min);
    var sMax   = Math.sqrt(lineStats.max);
    var sLines = Math.sqrt(lines);
    var t = (sLines - sMin) / (sMax - sMin);
    if (t < 0) t = 0; else if (t > 1) t = 1;
    floors = Math.round(bc.min_floors + t * (maxFloorsCap - bc.min_floors));
    if (floors < bc.min_floors) floors = bc.min_floors;
  }
  var height = floors * bc.floor_height;

  // ---- Width from file size in bytes ----------------------------------------
  // Log-scaled because file sizes legitimately span many orders of magnitude.
  var bytes = (file.size && file.size > 0) ? file.size : 1;
  var logBytes    = Math.log(bytes);
  var logBytesMax = Math.log(bc.size_ceiling_bytes);
  var tW = Math.max(0, Math.min(1, logBytes / logBytesMax));
  var width = bc.min_width + tW * (bc.max_width - bc.min_width);
  width = Math.max(bc.min_width, Math.min(bc.max_width, width));

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
// Street-network layout constants
// -----------------------------------------------------------------------------
// User-facing knobs (child_gap, bldg_street_gap) come from config.layout.
// These remaining constants are layout internals not worth surfacing.
var ROOT_END_PAD = 8;   // fallback pad for the root street (has no parent)

// Root-gem landing-zone defaults. The gem's center sits at the origin-end cap
// center (streetWidth/2 from the tip) and its radius is RADIUS_FRAC of the
// street width — so its far edge sits at (0.5 + RADIUS_FRAC) * streetWidth
// from the tip. Buildings must start past that, plus CLEARANCE of breathing
// room. These defaults are overridden by config.scene.root_gem so layout and
// engine cannot drift apart.
var ROOT_GEM_RADIUS_FRAC_DEFAULT = 0.35;
var ROOT_GEM_CLEARANCE_DEFAULT   = 20;


// -----------------------------------------------------------------------------
// layoutCity(manifest, config) -> { streets, buildings, paths }
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
export function layoutCity(manifest, config) {
  var tree = manifest.tree || manifest;
  var result = { streets: [], buildings: [], paths: [] };

  // Compute the project's line-count range once and stash it on `result` so
  // callers (main.js) can keep it for later toggle rebuilds, and so the
  // recursion below can pass it to every getBuildingDimensions call.
  var lineStats = computeLineStats(tree);
  result.lineStats = lineStats;

  _layoutDir(tree, config, 0, 0, 'x', result, undefined, lineStats);

  // Mark the root-dir street so the renderer can draw a distinct "start of
  // repo" marker at its origin end.
  for (var ri = 0; ri < result.streets.length; ri++) {
    if (result.streets[ri].dir === tree) {
      result.streets[ri].isRoot = true;
      break;
    }
  }

  // Compute paths from each building's door to the adjacent street. Path
  // length equals bldg_street_gap so it exactly bridges the building face
  // to the street edge.
  var lc = (config && config.layout) || {};
  var pathWidth  = (lc.path_width != null) ? lc.path_width : 3;
  var pathLength = (lc.bldg_street_gap != null) ? lc.bldg_street_gap : 4;
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
// _streetWidthForDir(dir, config) -> number
//
// Maps a directory's descendants to a tier and returns the visual width of
// its street. Larger directories get wider boulevards.
// -----------------------------------------------------------------------------
function _streetWidthForDir(dir, config) {
  var tiers = config && config.layout && config.layout.street_tiers;
  // Prefer descendants_count (total files+dirs under this node); fall back
  // to direct children_count for shallow trees / older manifests.
  var count = (dir && (dir.descendants_count || dir.children_count)) || 0;
  return getStreetWidth(count, tiers);
}


// -----------------------------------------------------------------------------
// _pathForBuilding(building, pathWidth, pathLength) -> path | null
//
// Returns a thin sidewalk-colored strip connecting the building's door (on its
// front face) to the adjacent street's sidewalk. `pathLength` should equal
// config.layout.bldg_street_gap so the path exactly bridges the gap between
// building face and street edge; `pathWidth` is the walkway's narrow dim.
// -----------------------------------------------------------------------------
function _pathForBuilding(b, pathWidth, pathLength) {
  if (b.orient === 's') {
    return {
      x: b.x,
      y: b.y + b.d / 2 + pathLength / 2,
      w: pathWidth,
      d: pathLength
    };
  }
  if (b.orient === 'e') {
    return {
      x: b.x + b.w / 2 + pathLength / 2,
      y: b.y,
      w: pathLength,
      d: pathWidth
    };
  }
  if (b.orient === 'n') {
    return {
      x: b.x,
      y: b.y - b.d / 2 - pathLength / 2,
      w: pathWidth,
      d: pathLength
    };
  }
  if (b.orient === 'w') {
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
// _layoutDir(dir, config, originX, originY, orientation, result)
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
function _layoutDir(dir, config, originX, originY, orientation, result, parentStreetWidth, lineStats) {
  // User-tunable gaps (pulled fresh so tests / runtime configs can override).
  var lc              = (config && config.layout) || {};
  var childGap        = (lc.child_gap       != null) ? lc.child_gap       : 5;
  var bldgStreetGap   = (lc.bldg_street_gap != null) ? lc.bldg_street_gap : 4;
  var PARENT_JOIN_PAD = 3;   // internal: extra clear space where a child meets its parent

  // Widths — this street's visual width comes from its descendants count, and
  // end-padding depends on the PARENT street's width so children don't cross
  // the parent intersection.
  var myStreetWidth = _streetWidthForDir(dir, config);
  var bldgOffset    = myStreetWidth / 2 + bldgStreetGap;
  var endPad        = parentStreetWidth
    ? parentStreetWidth / 2 + PARENT_JOIN_PAD
    : ROOT_END_PAD;
  // Root gets an asymmetric extra pad at its ORIGIN end only. That cap area
  // is kept clear of buildings so the root gem can float over it — the road
  // itself serves as the gem's plaza. Pad = half-width (cap center) + gem
  // radius + clearance. Non-root streets use endPad on both ends as before.
  var gemCfg       = (config && config.scene && config.scene.root_gem) || {};
  var gemRadiusFrac = (gemCfg.radius_as_street_frac != null) ? gemCfg.radius_as_street_frac : ROOT_GEM_RADIUS_FRAC_DEFAULT;
  var gemClearance  = (gemCfg.building_clearance    != null) ? gemCfg.building_clearance    : ROOT_GEM_CLEARANCE_DEFAULT;
  var originPad = !parentStreetWidth
    ? Math.max(endPad, myStreetWidth * (0.5 + gemRadiusFrac) + gemClearance)
    : endPad;

  // ---- Sort children alphabetically (files + dirs intermingled) -----------
  var children = (dir.children || [])
    .filter(function (c) { return c.type === 'file' || c.type === 'directory'; })
    .slice()
    .sort(function (a, b) {
      return (a.name || '').localeCompare(b.name || '');
    });

  var subOrient = (orientation === 'x') ? 'y' : 'x';

  // ---- Pre-compute each subdir's layout in its own local frame ------------
  // We need each subdir's bbox BEFORE positioning it, so siblings can be
  // packed without overlap. Local layout has subdir's street at (0,0) extending
  // in +subOrient. Pass myStreetWidth down so the child's own endPad respects
  // this (parent) street's footprint.
  var subLayouts = {};
  for (var i = 0; i < children.length; i++) {
    if (children[i].type === 'directory') {
      var localResult = { streets: [], buildings: [] };
      _layoutDir(children[i], config, 0, 0, subOrient, localResult, myStreetWidth, lineStats);
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

    if (child.type === 'file') {
      var dim = getBuildingDimensions(child, config, lineStats);
      var alongStreet = dim.w;
      var perpStreet  = dim.d;
      var sideIdx = preferredFileSide;

      // Anchor position: no earlier than this side's own cursor, and no
      // earlier than the global alphaCursor (so we stay after prior items).
      var startPos = Math.max(cursor[sideIdx], alphaCursor);
      var centerPos = startPos + alongStreet / 2;

      var bx, by, bldgW, bldgD, orient;
      if (orientation === 'x') {
        bx = originX + centerPos;
        if (sideIdx === 0) {
          by = originY - bldgOffset - perpStreet / 2;
          orient = 's';
        } else {
          by = originY + bldgOffset + perpStreet / 2;
          orient = 'n';
        }
        bldgW = alongStreet;
        bldgD = perpStreet;
      } else {
        by = originY + centerPos;
        if (sideIdx === 0) {
          bx = originX - bldgOffset - perpStreet / 2;
          orient = 'e';
        } else {
          bx = originX + bldgOffset + perpStreet / 2;
          orient = 'w';
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
      if (orientation === 'x') {
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

      var negateY = (orientation === 'x' && subSide === 0);
      var negateX = (orientation === 'y' && subSide === 0);

      var subAnchorX, subAnchorY;
      if (orientation === 'x') {
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
  if (orientation === 'x') {
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
    if (orient === 'e') orient = 'w';
    else if (orient === 'w') orient = 'e';
  }
  if (negateY) {
    if (orient === 's') orient = 'n';
    else if (orient === 'n') orient = 's';
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
    if (s.orientation === 'x') {
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
