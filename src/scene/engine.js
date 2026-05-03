// engine.js — Three.js scene builder. Turns layout output into a Scene of meshes.
//
// World axes: X east-west, Y north-south, Z up. Buildings are BoxGeometry with
// per-face CanvasTextures (floor bands, windows, ground-floor door). Streets
// are flat planes. The root of the tree gets a spinning gold octahedron on a
// plaza.

import * as THREE from 'three';
import { shadeColor, shadeAndShiftHue, shadeByRatio } from './hsl.js';


// -----------------------------------------------------------------------------
// Scene-wide constants
// -----------------------------------------------------------------------------
// Defaults for config.scene.* — used when no config is passed (e.g. tests).
// Active colors are set at the top of buildCityScene from config.scene and
// read from the helpers below.
var DEFAULT_SCENE_COLORS = {
  asphalt:       '#1a1d28',
  sidewalk:      '#2a3050',
  ground:        '#0a0b10',
  label_fill:    '#f4f6ff',
  label_stroke:  'rgba(8, 9, 14, 0.95)'
};


// _toPow2(n) — round n UP to the next power of two. Used so canvas-backed
// textures get mipmaps (Three.js requires power-of-2 dims for guaranteed
// mipmap support across all WebGL profiles).
function _toPow2(n) {
  var p = 1;
  while (p < n) p *= 2;
  return p;
}
var STREET_COLOR_ASPHALT  = DEFAULT_SCENE_COLORS.asphalt;
var STREET_COLOR_SIDEWALK = DEFAULT_SCENE_COLORS.sidewalk;
var GROUND_COLOR          = DEFAULT_SCENE_COLORS.ground;
var LABEL_FILL            = DEFAULT_SCENE_COLORS.label_fill;
var LABEL_STROKE          = DEFAULT_SCENE_COLORS.label_stroke;


// -----------------------------------------------------------------------------
// _buildFacadeTexture(opts) -> THREE.CanvasTexture
//
// Paints the side of a building onto a 2D canvas and returns it as a Three.js
// texture. The texture encodes:
//   - the wall base color
//   - a thin darker slab band at each floor ceiling
//   - a grid of lighter window rectangles, one row per floor
//   - (optional) a door on the ground floor
//
// The texture is sampled across the full face, so widths/heights in the
// building mesh are real-world units — the texture stretches to fit.
// -----------------------------------------------------------------------------
function _buildFacadeTexture(opts) {
  var floors     = opts.floors;
  var cols       = opts.cols;
  var wallColor  = opts.wallColor;
  var slabColor  = opts.slabColor;
  var winColor   = opts.winColor;
  var doorColor  = opts.doorColor;
  var hasDoor    = !!opts.hasDoor;

  // Pixel canvas — round dimensions UP to the next power of two so Three.js
  // can generate mipmaps. Without mipmaps, zoomed-out facades shimmer/blur
  // via single-texel sampling.
  // pxPerFloor / pxPerCol are then RECOMPUTED from the rounded canvas so
  // floors and columns fill the canvas evenly — otherwise the drawing
  // (which anchors floors at the bottom) would leave a huge blank stripe
  // at the top of the texture, making the building look half-empty.
  var width  = _toPow2(Math.max(128, 128 * cols));
  var height = _toPow2(Math.max(64,  64  * floors));
  var pxPerFloor = height / floors;
  var pxPerCol   = width  / cols;

  var canvas = document.createElement('canvas');
  canvas.width  = width;
  canvas.height = height;
  var ctx = canvas.getContext('2d');

  // Base wall color
  ctx.fillStyle = wallColor;
  ctx.fillRect(0, 0, width, height);

  // Slab band at the top of every floor (a thin horizontal stripe)
  ctx.fillStyle = slabColor;
  var slabPx = Math.max(3, Math.floor(pxPerFloor * 0.12));
  for (var fi = 0; fi < floors; fi++) {
    // Texture Y=0 is the TOP of the face. Floor `fi` (counting from the
    // ground) occupies texture rows [height - (fi+1)*pxPerFloor, height - fi*pxPerFloor].
    // The slab sits at the top of that span.
    var bandTop = height - (fi + 1) * pxPerFloor;
    ctx.fillRect(0, bandTop, width, slabPx);
  }

  // Windows — one row per floor, `cols` columns across, inset within a
  // margin on each face edge.
  var marginX = Math.floor(width  * 0.08);
  var cellW   = (width - 2 * marginX) / cols;
  var winW    = Math.floor(cellW * 0.45);
  var winH    = Math.floor(pxPerFloor * 0.45);

  ctx.fillStyle = winColor;
  for (var f = 0; f < floors; f++) {
    var floorBottomPx = height - f * pxPerFloor;
    var floorTopPx    = floorBottomPx - pxPerFloor;
    // Window row sits roughly centered in the floor, above the slab band.
    var winCenterY    = floorTopPx + slabPx + (pxPerFloor - slabPx) / 2;
    var winY          = Math.floor(winCenterY - winH / 2);

    // Skip this floor's window row on the door face, ground floor only.
    if (hasDoor && f === 0) continue;

    for (var c = 0; c < cols; c++) {
      var cellCenterX = marginX + cellW * (c + 0.5);
      var winX        = Math.floor(cellCenterX - winW / 2);
      ctx.fillRect(winX, winY, winW, winH);
    }
  }

  // Door — centered on the ground floor, on the door face.
  if (hasDoor) {
    var doorW = Math.floor(width * 0.14);
    var doorH = Math.floor(pxPerFloor * 0.7);
    var doorX = Math.floor((width - doorW) / 2);
    var doorY = height - doorH;
    ctx.fillStyle = doorColor;
    ctx.fillRect(doorX, doorY, doorW, doorH);
  }

  var tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  // mag = Nearest, min = NearestMipmapLinear: pixel-perfect crispness at
  // every distance. Nearest sampling within each mipmap keeps window edges
  // sharp; linear blending BETWEEN mipmap levels prevents shimmer when
  // small/distant. (LinearMipmapLinear was tried first but smoothed the
  // window pixels into a soft blur — wrong for the blocky pixel-art look.)
  tex.magFilter   = THREE.NearestFilter;
  tex.minFilter   = THREE.NearestMipmapLinearFilter;
  tex.generateMipmaps = true;
  return tex;
}


// -----------------------------------------------------------------------------
// _buildRoofTexture(opts) -> THREE.CanvasTexture
//
// A simple texture for the top face: flat roof color with a faint darker
// border so it reads as a roof slab rather than a featureless cap.
// -----------------------------------------------------------------------------
function _buildRoofTexture(opts) {
  var canvas = document.createElement('canvas');
  canvas.width  = 128;
  canvas.height = 128;
  var ctx = canvas.getContext('2d');
  ctx.fillStyle = opts.roofColor;
  ctx.fillRect(0, 0, 128, 128);
  // Subtle border
  ctx.strokeStyle = opts.borderColor;
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, 124, 124);
  var tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestMipmapLinearFilter;
  tex.generateMipmaps = true;
  return tex;
}


// -----------------------------------------------------------------------------
// createBuildingMesh(building) -> THREE.Mesh
//
// Builds a single building mesh from a layout Building object:
//   { x, y, w, d, h, color, orient, file }
//
// Three.js box geometry has 6 faces; we assign a material per face with a
// CanvasTexture that paints the right pattern for each side. Texture widths
// are based on the number of window columns per face (so tall, thin buildings
// get narrow one-window-wide textures and wide buildings get more columns).
//
// The mesh is positioned so its base sits on z=0 and its center is at (x, y).
// `building.file` is attached to `mesh.userData.building` so raycast hits can
// look the original building object back up.
// -----------------------------------------------------------------------------
export function createBuildingMesh(building) {
  var w = building.w;
  var d = building.d;
  var color = building.color || 'hsl(220, 10%, 40%)';

  // Floor count + height come straight from layout (layout is the source of
  // truth for the lines→floors mapping and snaps h to floor_height boundaries).
  var floors  = Math.max(1, building.floors || 1);
  var renderH = building.h;

  // Scene convention: Three.js Y is up. Layout coords (x, y) map to scene
  // (x, z) with building height along scene-Y. So a BoxGeometry(w, renderH, d)
  // has its sides running along world-X and world-Z — exactly what we want.
  //
  // BoxGeometry material order: [+X, -X, +Y, -Y, +Z, -Z]
  // Window-column counts scale with each face's horizontal extent:
  //   ±X faces (east/west walls)   have horizontal extent = d
  //   ±Z faces (north/south walls) have horizontal extent = w
  var colsEW = Math.max(1, Math.min(5, Math.floor(d / 8)));
  var colsNS = Math.max(1, Math.min(5, Math.floor(w / 8)));

  // Palette — opposing faces share a color so the building looks symmetric
  // as the camera orbits. Front/back faces use a slight absolute lightness
  // bump; side faces use a MULTIPLICATIVE darkening so they always read as
  // proportionally darker than the front regardless of the base lightness,
  // with an absolute floor that keeps them from crushing to pure black on
  // dim files (old/untouched) and blending into the dark background.
  var wallFront  = shadeAndShiftHue(color,  -5,  18);           // lighter, warmer
  var wallSide   = shadeByRatio(color, 0.55, -10, 14);          // ~45% darker, floor 14
  var slabFront  = shadeAndShiftHue(color, -15,  18);
  var slabSide   = shadeByRatio(color, 0.40, -10, 10);
  var winColor   = shadeColor(color,  20);
  var doorColor  = shadeAndShiftHue(color, -55,  0);
  var roofColor  = color;
  var roofBorder = shadeAndShiftHue(color, -15, 0);

  // Door face mapping. Layout orient describes which face actually points at
  // the adjacent street; scene maps layout-y to scene-z.
  //   's' → door on layout +y = scene +Z (material index 4)
  //   'n' → door on layout -y = scene -Z (material index 5)
  //   'e' → door on layout +x = scene +X (material index 0)
  //   'w' → door on layout -x = scene -X (material index 1)
  var orient = building.orient || 's';
  var doorOnEW = (orient === 'e' || orient === 'w');

  // Assign the lighter "front" palette to the pair of faces that contains
  // the door; the other pair gets the darker "side" palette.
  var wallNS = doorOnEW ? wallSide  : wallFront;
  var wallEW = doorOnEW ? wallFront : wallSide;
  var slabNS = doorOnEW ? slabSide  : slabFront;
  var slabEW = doorOnEW ? slabFront : slabSide;

  var geometry = new THREE.BoxGeometry(w, renderH, d);

  // One material per face, in BoxGeometry order: [+X, -X, +Y, -Y, +Z, -Z].
  function facadeMat(cols, hasDoor, wallColor, slabColor) {
    var tex = _buildFacadeTexture({
      floors: floors,
      cols: cols,
      wallColor: wallColor,
      slabColor: slabColor,
      winColor: winColor,
      doorColor: doorColor,
      hasDoor: hasDoor
    });
    return new THREE.MeshBasicMaterial({ map: tex });
  }

  function roofMat() {
    var tex = _buildRoofTexture({ roofColor: roofColor, borderColor: roofBorder });
    return new THREE.MeshBasicMaterial({ map: tex });
  }

  function bottomMat() {
    return new THREE.MeshBasicMaterial({ color: new THREE.Color(wallEW) });
  }

  var materials = [
    facadeMat(colsEW, orient === 'e', wallEW, slabEW),   // +X (east)
    facadeMat(colsEW, orient === 'w', wallEW, slabEW),   // -X (west)
    roofMat(),                                            // +Y (roof)
    bottomMat(),                                          // -Y (bottom)
    facadeMat(colsNS, orient === 's', wallNS, slabNS),   // +Z (south)
    facadeMat(colsNS, orient === 'n', wallNS, slabNS)    // -Z (north)
  ];

  var mesh = new THREE.Mesh(geometry, materials);

  // Position: building center in XY plane, base sits on z=0.
  // We use Three.js default Y-up internally but position Y to be "up" in the
  // scene as well — the camera is set up for that. World-space mapping from
  // layout (x, y, z-up) to scene (x, y-up, z):
  //     scene.x = layout.x
  //     scene.y = layout.z (height)
  //     scene.z = layout.y
  mesh.position.set(building.x, renderH / 2, building.y);

  mesh.userData.building = building;
  mesh.userData.type = 'building';
  return mesh;
}


// -----------------------------------------------------------------------------
// Ground-plane materials — all the flat pieces (sidewalk, asphalt, paths)
// sit at the same world Y. `polygonOffset` alone isn't enough to kill
// z-fighting between coplanar meshes at typical camera distances, so we
// also disable depth-write and control their stacking via `renderOrder`:
// the lowest renderOrder draws first, higher orders draw on top cleanly
// regardless of their actual Y coordinate.
//
// Ground planes still `depthTest` so buildings occlude them correctly.
// -----------------------------------------------------------------------------
function _flatMat(color, renderOrderLayer) {
  var mat = new THREE.MeshBasicMaterial({
    color: color,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -renderOrderLayer,
    polygonOffsetUnits: -renderOrderLayer
  });
  mat.userData.renderOrderLayer = renderOrderLayer;
  return mat;
}


// -----------------------------------------------------------------------------
// -----------------------------------------------------------------------------
// _buildStadiumGeometry(length, width, orientation) -> THREE.ShapeGeometry
//
// A stadium/pill shape: a rectangle with two full semicircular end caps of
// radius width/2. The shape lives in the XY plane and is meant to be rotated
// -PI/2 around X to lie flat on the world XZ plane. `orientation` picks
// which 2D axis the long direction runs along so the street's long axis
// ends up along world-X or world-Z.
// -----------------------------------------------------------------------------
function _buildStadiumGeometry(length, width, orientation) {
  var r = width / 2;
  var halfStraight = Math.max(0, length / 2 - r);
  var shape = new THREE.Shape();
  if (orientation === 'x') {
    shape.moveTo(-halfStraight, -r);
    shape.lineTo(halfStraight, -r);
    shape.absarc(halfStraight, 0, r, -Math.PI / 2, Math.PI / 2, false);
    shape.lineTo(-halfStraight, r);
    shape.absarc(-halfStraight, 0, r, Math.PI / 2, 3 * Math.PI / 2, false);
  } else {
    shape.moveTo(-r, -halfStraight);
    shape.absarc(0, -halfStraight, r, Math.PI, 2 * Math.PI, false);
    shape.lineTo(r, halfStraight);
    shape.absarc(0, halfStraight, r, 0, Math.PI, false);
  }
  return new THREE.ShapeGeometry(shape, 16);
}


// -----------------------------------------------------------------------------
// createStreetMesh(street) -> THREE.Group
//
// A street is two stacked flat pill-shaped slabs — sidewalk (outer) and
// asphalt (inner). The asphalt pill is sized and positioned so its cap
// circle is CONCENTRIC with the sidewalk cap circle, which keeps the
// visible sidewalk strip a uniform width all the way around the perimeter
// (including around the curved end caps). The group's userData.street
// points back to the layout street so raycaster hits can recover the
// directory this street represents.
// -----------------------------------------------------------------------------
function createStreetMesh(street, yBase) {
  var group = new THREE.Group();
  var asphaltFrac = 0.6;
  var asphaltWidth = street.width * asphaltFrac;
  // For concentric caps the asphalt must be shorter by exactly the sidewalk
  // strip width (= (width - asphaltWidth) / 2 per side). That makes the two
  // cap circles share a center and the annular sidewalk strip keep constant
  // thickness around the curve. Floor at a small fraction of length so very
  // short streets still show some asphalt.
  var sidewalkStrip = (street.width - asphaltWidth) / 2;
  var asphaltLength = Math.max(street.length * 0.2, street.length - 2 * sidewalkStrip);

  // Sidewalk — the clickable target for street picking. renderOrder=1
  // means all sidewalks across the city draw first, as a single bottom layer.
  var sidewalk = new THREE.Mesh(
    _buildStadiumGeometry(street.length, street.width, street.orientation),
    _flatMat(STREET_COLOR_SIDEWALK, 1)
  );
  sidewalk.rotation.x = -Math.PI / 2;
  sidewalk.position.set(street.x, yBase, street.y);
  sidewalk.renderOrder = 1;
  sidewalk.userData.street = street;
  sidewalk.userData.type = 'street';
  group.add(sidewalk);

  // Asphalt — narrower, always draws on top of every sidewalk (renderOrder=3).
  var asphalt = new THREE.Mesh(
    _buildStadiumGeometry(asphaltLength, asphaltWidth, street.orientation),
    _flatMat(STREET_COLOR_ASPHALT, 3)
  );
  asphalt.rotation.x = -Math.PI / 2;
  asphalt.position.set(street.x, yBase, street.y);
  asphalt.renderOrder = 3;
  group.add(asphalt);

  group.userData.street = street;
  group.userData.sidewalk = sidewalk;   // exposed so callers can pick on it
  group.userData.type = 'street';
  return group;
}


// -----------------------------------------------------------------------------
// createRootGem(street) -> THREE.Group
//
// A floating, slowly spinning octahedron gem hovering over the ORIGIN-END
// cap of the root street — the layout reserves dead space at that end so
// the rounded cap area is clear of buildings and the road itself acts as
// the gem's plaza (no separate pad mesh). Each of the 8 gem faces gets a
// different vibrant color (per-vertex colors on a non-indexed octahedron).
// Render loop drives the rotation and a subtle bob via `userData.gem`.
// -----------------------------------------------------------------------------
// 8 gem faces in a PRISMATIC palette — high-saturation hues spaced around the
// color wheel so no face blends with nearby building colors and the gem reads
// as an unambiguous "root" beacon regardless of what's around it.
var _GEM_FACE_COLORS = [
  [1.00, 0.20, 0.55],   // hot pink
  [0.15, 0.90, 1.00],   // cyan
  [0.75, 1.00, 0.20],   // chartreuse
  [0.60, 0.25, 1.00],   // violet
  [1.00, 0.55, 0.10],   // orange
  [1.00, 0.20, 0.90],   // magenta
  [0.15, 1.00, 0.75],   // aqua
  [0.40, 1.00, 0.30]    // lime
];
var _GEM_EDGES_DEFAULT = 0xf0f0ff;   // near-white separator between vivid faces

function createRootGem(street, gemCfg) {
  var edgeColor = (gemCfg && gemCfg.edge_color) || _GEM_EDGES_DEFAULT;
  var group = new THREE.Group();

  // Gem size scales with the street's width. The layout reserves extra dead
  // space at the root street's origin end (see config.scene.root_gem), so the
  // origin cap has no buildings overlapping it — the road's rounded cap IS
  // the plaza. radius_as_street_frac MUST match what layout.js used to
  // reserve that pad.
  var radiusFrac = (gemCfg.radius_as_street_frac != null) ? gemCfg.radius_as_street_frac : 0.35;
  var minRadius  = (gemCfg.min_radius             != null) ? gemCfg.min_radius             : 5;
  var hoverFrac  = (gemCfg.hover_lift_frac        != null) ? gemCfg.hover_lift_frac        : 0.3;
  var bobFrac    = (gemCfg.bob_amplitude_frac     != null) ? gemCfg.bob_amplitude_frac     : 0.5;

  var radius = street.width * radiusFrac;
  if (radius < minRadius) radius = minRadius;
  var hoverY = radius + street.width * hoverFrac;

  // Gem hovers at the center of the road's origin-end cap. For a stadium of
  // length L and width W, the origin cap circle is centered at a distance
  // W/2 inward from the tip.
  var gemX, gemZ;
  if (street.orientation === 'x') {
    gemX = street.x - street.length / 2 + street.width / 2;
    gemZ = street.y;
  } else {
    gemX = street.x;
    gemZ = street.y - street.length / 2 + street.width / 2;
  }

  // ---- Gem: per-face colored octahedron -------------------------------------
  var geo = new THREE.OctahedronGeometry(radius, 0);
  var colorAttr = new Float32Array(geo.attributes.position.count * 3);
  for (var f = 0; f < 8; f++) {
    var fc = _GEM_FACE_COLORS[f];
    for (var v = 0; v < 3; v++) {
      var idx = (f * 3 + v) * 3;
      colorAttr[idx]     = fc[0];
      colorAttr[idx + 1] = fc[1];
      colorAttr[idx + 2] = fc[2];
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colorAttr, 3));

  var body = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.9,
    depthWrite: false
  }));

  var edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geo),
    new THREE.LineBasicMaterial({ color: new THREE.Color(edgeColor) })
  );

  var gem = new THREE.Group();
  gem.add(body);
  gem.add(edges);
  gem.position.set(gemX, hoverY, gemZ);
  gem.userData.baseY = hoverY;
  gem.userData.bobAmp = radius * bobFrac;
  gem.userData.type = 'root-gem';

  group.add(gem);
  group.userData.gem = gem;
  return group;
}


// -----------------------------------------------------------------------------
// createPathMesh(path) -> THREE.Mesh
//
// Thin sidewalk-colored strip connecting a building's door to the adjacent
// street. Sits between the sidewalk and asphalt layers via polygonOffset so
// it doesn't z-fight at intersections with either.
// -----------------------------------------------------------------------------
function createPathMesh(path, yBase) {
  // Paths sit between sidewalks (1) and asphalts (3) so they extend the
  // sidewalk all the way to the building without overdrawing the asphalt.
  var mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(path.w, path.d),
    _flatMat(STREET_COLOR_SIDEWALK, 2)
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(path.x, yBase, path.y);
  mesh.renderOrder = 2;
  mesh.userData.file = path.file || null;
  return mesh;
}


// -----------------------------------------------------------------------------
// createStreetLabels(street) -> THREE.Group[]
//
// Flat text painted on the road, aligned with the street's long axis (like
// labels on a map). Longer streets repeat the label so you always have one
// nearby. Each label is a plane lifted a tiny amount above the asphalt so it
// doesn't z-fight with the road, and it participates in normal depth testing
// so buildings occlude it correctly — no clipping through them.
//
// Each returned Group wraps one label plane and exposes its orientation via
// userData so the render loop can flip it 180° around scene-Y when the
// camera orbits to the "upside-down" side.
// -----------------------------------------------------------------------------
function _buildLabelTexture(text) {
  // High source resolution so close-zoom doesn't reveal bilinear blur.
  // The world-space plane size is unchanged — we're just packing more
  // texels into the same footprint.
  var fontPx = 192;
  var pad    = 48;
  var stroke = 32;
  var measure = document.createElement('canvas').getContext('2d');
  measure.font = '700 ' + fontPx + 'px Inter, "SF Mono", sans-serif';
  var textW = Math.ceil(measure.measureText(text).width);
  var canvas = document.createElement('canvas');
  canvas.width  = textW + pad * 2;
  canvas.height = fontPx + pad * 2;
  var ctx = canvas.getContext('2d');
  ctx.font = '700 ' + fontPx + 'px Inter, "SF Mono", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.lineWidth = stroke;
  ctx.strokeStyle = LABEL_STROKE;
  ctx.strokeText(text, canvas.width / 2, canvas.height / 2);
  ctx.fillStyle = LABEL_FILL;
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  var tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 16;
  return { texture: tex, aspect: canvas.width / canvas.height };
}

function createStreetLabels(street) {
  var text = street.label || '';
  if (!text) return [];

  var info = _buildLabelTexture(text);

  // Label sizing scales with street width — narrow alleys get small text,
  // wide boulevards get large text — so the label always fits its asphalt
  // and reads at a consistent proportion of the street it's labeling.
  var worldH = street.width * 0.45;
  var worldW = worldH * info.aspect;

  // Repetition: spacing scales with the label's own rendered width so long
  // names ("codecity-ai") don't pile up on wide streets while short names
  // ("src") still repeat often enough to always have one near the viewport.
  // A minimum floor keeps tiny labels from repeating every few units.
  var spacing = Math.max(worldW * 3.5, 200);
  var count   = Math.max(1, Math.floor(street.length / spacing));

  var labels = [];
  for (var i = 0; i < count; i++) {
    var t = (count === 1) ? 0.5 : (i + 0.5) / count;
    var offset = (t - 0.5) * street.length;
    var sx = street.x, sz = street.y;
    if (street.orientation === 'x') sx += offset;
    else                             sz += offset;

    var mat = new THREE.MeshBasicMaterial({
      map: info.texture,
      transparent: true,
      // Don't write depth — otherwise the plane's transparent canvas pixels
      // z-block the neon path running underneath, leaving a visible
      // bbox-shaped hole. With depthWrite off, opaque glyph pixels still
      // alpha-blend over the path, but letter loops (O, D, P) reveal it.
      depthWrite: false
    });
    var plane = new THREE.Mesh(new THREE.PlaneGeometry(worldW, worldH), mat);
    plane.rotation.x = -Math.PI / 2;   // lay flat
    // Render AFTER the neon path line (renderOrder 4) so the label
    // composites on top via alpha blending.
    plane.renderOrder = 6;

    // Wrap in a group so we can apply a single rotation.y for camera-follow
    // flipping without fighting the Euler order of the flattened plane.
    var group = new THREE.Group();
    group.add(plane);
    // Lift a tiny amount off the asphalt to avoid coplanar z-fighting, while
    // staying well below building tops so buildings still occlude the label.
    group.position.set(sx, 0.5, sz);
    // Base rotation per orientation. For y-streets the label's reading
    // direction needs to run along scene-Z, so rotate the group 90°.
    group.userData.baseRotY = (street.orientation === 'y') ? -Math.PI / 2 : 0;
    group.rotation.y = group.userData.baseRotY;
    group.userData.street = street;
    group.userData.type = 'street-label';
    labels.push(group);
  }
  return labels;
}


export function buildCityScene(layout, config) {
  // Resolve scene colors from config (falling back to defaults). Module-level
  // vars are set here so the street/path helpers below pick them up without
  // needing to thread `config` through each function.
  var sc = (config && config.scene) || {};
  STREET_COLOR_ASPHALT  = sc.asphalt || DEFAULT_SCENE_COLORS.asphalt;
  // Sidewalk is now a {default, hover, selected, path} object — engine
  // only paints the default tint; main.js drives the hover/selected/path
  // recolors from sc.sidewalk.{hover,selected,path}.
  var sidewalkCfg = sc.sidewalk || {};
  STREET_COLOR_SIDEWALK = sidewalkCfg.default || DEFAULT_SCENE_COLORS.sidewalk;
  GROUND_COLOR          = sc.ground || DEFAULT_SCENE_COLORS.ground;
  var labelCfg = sc.label || {};
  LABEL_FILL    = labelCfg.fill   || DEFAULT_SCENE_COLORS.label_fill;
  LABEL_STROKE  = labelCfg.stroke || DEFAULT_SCENE_COLORS.label_stroke;
  var gemCfg            = sc.root_gem || {};

  var scene = new THREE.Scene();
  scene.background = new THREE.Color(GROUND_COLOR);

  // Streets + their labels
  var streets = layout.streets || [];
  var streetPickables = [];
  var streetLabels = [];
  var rootGem = null;
  for (var si = 0; si < streets.length; si++) {
    var sg = createStreetMesh(streets[si], 0);
    scene.add(sg);
    streetPickables.push(sg.userData.sidewalk);

    var labels = createStreetLabels(streets[si]);
    for (var li = 0; li < labels.length; li++) {
      scene.add(labels[li]);
      streetLabels.push(labels[li]);
    }

    // Root-of-repo landmark at the street's origin end.
    if (streets[si].isRoot) {
      var gemGroup = createRootGem(streets[si], gemCfg);
      scene.add(gemGroup);
      rootGem = gemGroup.userData.gem;
    }
  }

  // Paths
  var pathMeshes = [];
  var paths = layout.paths || [];
  for (var pi = 0; pi < paths.length; pi++) {
    var pm = createPathMesh(paths[pi], 0);
    scene.add(pm);
    pathMeshes.push(pm);
  }

  // Buildings
  var buildingMeshes = [];
  var buildings = layout.buildings || [];
  for (var bi = 0; bi < buildings.length; bi++) {
    var b = buildings[bi];
    if (b.file && b.file.type === 'directory') continue;
    var mesh = createBuildingMesh(b);
    scene.add(mesh);
    buildingMeshes.push(mesh);
  }

  // Bounding box of the whole city (in scene coords). Used by the caller to
  // frame the camera.
  var bbox = new THREE.Box3().setFromObject(scene);
  if (bbox.isEmpty()) {
    bbox.set(new THREE.Vector3(-50, 0, -50), new THREE.Vector3(50, 10, 50));
  }

  return {
    scene: scene,
    buildingMeshes: buildingMeshes,
    streetPickables: streetPickables,
    streetLabels: streetLabels,
    pathMeshes: pathMeshes,
    rootGem: rootGem,
    bbox: bbox
  };
}
