// engine.ts — Three.js scene builder. Turns layout output into a Scene of meshes.
//
// World axes: X east-west, Y north-south, Z up. Buildings are BoxGeometry with
// per-face CanvasTextures (floor bands, windows, ground-floor door). Streets
// are flat planes. The root of the tree gets a spinning gold octahedron on a
// plaza.

import * as THREE from 'three';
import { shadeColor, shadeAndShiftHue, shadeByRatio } from './hsl.js';
import {
  SCENE_COLORS,
  ASPHALT,
  SIDEWALK_COLORS,
  LABEL_TYPOGRAPHY,
  BUILDING_DIMENSIONS,
  GEM_SIZING,
  GEM_FACE_PALETTE,
  GEM_APPEARANCE,
  GEM_ANIMATION,
} from '../config/index.js';
import { RENDER_ORDERS } from '../constants';
import { BuildingOrient, NodeKind, StreetAxis } from '../types';
import type { Building, BuildingPath, CityLayout, Street } from '../types';

// Internal-only types for engine helpers.
interface FacadeOpts {
  floors: number;
  cols: number;
  wallColor: string;
  slabColor: string;
  winColor: string;
  doorColor: string;
  hasDoor: boolean;
  faceWorldWidth: number;
  doorWorldWidth: number;
}
interface RoofOpts {
  roofColor: string;
  borderColor: string;
}
type CapStyle = 'both' | 'low' | 'high';
type StreetWithJoin = Street & { joinSide?: 'low' | 'high' };

// ─── Renderer-internal constants (not designer-tunable) ────────────────────
// These shape facade textures, color derivation, and stadium tessellation.
// Changing them changes the look of every building, but they're not user
// dials — leaving them as plain consts keeps the user-facing config surface
// (sliders/colors in the Settings UI) free of implementation noise.

// Facade canvas / window math. Door WIDTH is no longer in here — it's
// derived per-building from the building's own width × PATH_WIDTH_FRAC
// (see DOOR_WIDTH_OF_PATH below) so doors visually match the path strip
// that connects the building to its sidewalk.
const FACADE = Object.freeze({
  TEXTURE_MIN_WIDTH_PX: 128,
  TEXTURE_WIDTH_PER_COL_MULT: 128,
  TEXTURE_MIN_HEIGHT_PX: 64,
  TEXTURE_HEIGHT_PER_FLOOR_MULT: 64,
  ANISOTROPY: 8,
  SLAB_BAND_MIN_PX: 3,
  SLAB_HEIGHT_FRAC: 0.12,
  WINDOW_MARGIN_FRAC: 0.08,
  WINDOW_WIDTH_FRAC: 0.45,
  WINDOW_HEIGHT_FRAC: 0.45,
  WINDOW_COLS_SIZE_DIVISOR: 8,
  WINDOW_COLS_MAX: 5,
  DOOR_HEIGHT_FRAC: 0.7,
});

// Door world width = (building.w × PATH_WIDTH_FRAC) × this. Keeps the
// door visually matched to its path connector strip (which is the same
// per-building width) so the "walk out the door onto the path" reading
// lands regardless of how big the building is.
const DOOR_WIDTH_OF_PATH = 0.8;

// Per-face palette derivation: front/side/slab/window/door/roof shifts off
// the building's base color.
//   *_LIGHTNESS_DELTA — additive lightness shift in HSL %
//   *_HUE_SHIFT       — hue rotation in degrees
//   *_DARKEN_RATIO    — multiplicative darkening (1.0 = unchanged)
//   *_LIGHTNESS_FLOOR — clamp floor so dim files don't crush to black
const SHADING = Object.freeze({
  WALL_FRONT_LIGHTNESS_DELTA: -5,
  WALL_FRONT_HUE_SHIFT: 18,
  WALL_SIDE_DARKEN_RATIO: 0.55,
  WALL_SIDE_LIGHTNESS_DELTA: -10,
  WALL_SIDE_LIGHTNESS_FLOOR: 14,
  SLAB_FRONT_LIGHTNESS_DELTA: -15,
  SLAB_FRONT_HUE_SHIFT: 18,
  SLAB_SIDE_DARKEN_RATIO: 0.4,
  SLAB_SIDE_LIGHTNESS_DELTA: -10,
  SLAB_SIDE_LIGHTNESS_FLOOR: 10,
  WINDOW_LIGHTNESS_DELTA: 20,
  DOOR_LIGHTNESS_DELTA: -55,
  ROOF_BORDER_LIGHTNESS_DELTA: -15,
});

// Stadium-cap tessellation count for the asphalt + sidewalk shapes.
const STADIUM_SEGMENTS = 16;

// Label canvas drawing internals — must stay 'center'/'middle' for the
// centered draw math, and label texture filtering anisotropy.
const LABEL_TEXT_ALIGN = 'center';
const LABEL_TEXT_BASELINE = 'middle';
const LABEL_ANISOTROPY = 16;

// _toPow2(n) — round n UP to the next power of two. Used so canvas-backed
// textures get mipmaps (Three.js requires power-of-2 dims for guaranteed
// mipmap support across all WebGL profiles).
function _toPow2(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

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
function _buildFacadeTexture(opts: FacadeOpts): THREE.CanvasTexture {
  const facade = FACADE;
  const floors = opts.floors;
  const cols = opts.cols;
  const wallColor = opts.wallColor;
  const slabColor = opts.slabColor;
  const winColor = opts.winColor;
  const doorColor = opts.doorColor;
  const hasDoor = !!opts.hasDoor;

  // Pixel canvas — round dimensions UP to the next power of two so Three.js
  // can generate mipmaps. Without mipmaps, zoomed-out facades shimmer/blur
  // via single-texel sampling.
  // pxPerFloor / pxPerCol are then RECOMPUTED from the rounded canvas so
  // floors and columns fill the canvas evenly — otherwise the drawing
  // (which anchors floors at the bottom) would leave a huge blank stripe
  // at the top of the texture, making the building look half-empty.
  const width = _toPow2(
    Math.max(facade.TEXTURE_MIN_WIDTH_PX, facade.TEXTURE_WIDTH_PER_COL_MULT * cols)
  );
  const height = _toPow2(
    Math.max(facade.TEXTURE_MIN_HEIGHT_PX, facade.TEXTURE_HEIGHT_PER_FLOOR_MULT * floors)
  );
  const pxPerFloor = height / floors;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  // Base wall color
  ctx.fillStyle = wallColor;
  ctx.fillRect(0, 0, width, height);

  // Slab band at the top of every floor (a thin horizontal stripe)
  ctx.fillStyle = slabColor;
  const slabPx = Math.max(
    facade.SLAB_BAND_MIN_PX,
    Math.floor(pxPerFloor * facade.SLAB_HEIGHT_FRAC)
  );
  for (let fi = 0; fi < floors; fi++) {
    // Texture Y=0 is the TOP of the face. Floor `fi` (counting from the
    // ground) occupies texture rows [height - (fi+1)*pxPerFloor, height - fi*pxPerFloor].
    // The slab sits at the top of that span.
    const bandTop = height - (fi + 1) * pxPerFloor;
    ctx.fillRect(0, bandTop, width, slabPx);
  }

  // Windows — one row per floor, `cols` columns across, inset within a
  // margin on each face edge.
  const marginX = Math.floor(width * facade.WINDOW_MARGIN_FRAC);
  const cellW = (width - 2 * marginX) / cols;
  const winW = Math.floor(cellW * facade.WINDOW_WIDTH_FRAC);
  const winH = Math.floor(pxPerFloor * facade.WINDOW_HEIGHT_FRAC);

  ctx.fillStyle = winColor;
  for (let f = 0; f < floors; f++) {
    const floorBottomPx = height - f * pxPerFloor;
    const floorTopPx = floorBottomPx - pxPerFloor;
    // Window row sits roughly centered in the floor, above the slab band.
    const winCenterY = floorTopPx + slabPx + (pxPerFloor - slabPx) / 2;
    const winY = Math.floor(winCenterY - winH / 2);

    // Skip this floor's window row on the door face, ground floor only.
    if (hasDoor && f === 0) continue;

    for (let c = 0; c < cols; c++) {
      const cellCenterX = marginX + cellW * (c + 0.5);
      const winX = Math.floor(cellCenterX - winW / 2);
      ctx.fillRect(winX, winY, winW, winH);
    }
  }

  // Door — centered on the ground floor, on the door face. Pixel width
  // comes from the caller's requested WORLD width × (canvas pixels per
  // world unit on this face). Caller passes faceWorldWidth + the desired
  // doorWorldWidth so the door visually matches the path connector strip.
  if (hasDoor) {
    const pxPerWorldUnit = width / opts.faceWorldWidth;
    let doorW = Math.floor(opts.doorWorldWidth * pxPerWorldUnit);
    if (doorW < 1) doorW = 1;
    if (doorW > width) doorW = width;
    const doorH = Math.floor(pxPerFloor * facade.DOOR_HEIGHT_FRAC);
    const doorX = Math.floor((width - doorW) / 2);
    const doorY = height - doorH;
    ctx.fillStyle = doorColor;
    ctx.fillRect(doorX, doorY, doorW, doorH);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = facade.ANISOTROPY;
  // mag = Nearest, min = NearestMipmapLinear: pixel-perfect crispness at
  // every distance. Nearest sampling within each mipmap keeps window edges
  // sharp; linear blending BETWEEN mipmap levels prevents shimmer when
  // small/distant. (LinearMipmapLinear was tried first but smoothed the
  // window pixels into a soft blur — wrong for the blocky pixel-art look.)
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestMipmapLinearFilter;
  tex.generateMipmaps = true;
  return tex;
}

// -----------------------------------------------------------------------------
// _buildRoofTexture(opts) -> THREE.CanvasTexture
//
// A simple texture for the top face: flat roof color with a faint darker
// border so it reads as a roof slab rather than a featureless cap.
// -----------------------------------------------------------------------------
function _buildRoofTexture(opts: RoofOpts): THREE.CanvasTexture {
  const facade = FACADE;
  // Roof texture is a small fixed-size pixel canvas — we use the facade
  // anisotropy so roof + walls share the same min/mag filter feel. The
  // 128px canvas + 4/2/124 border insets are visual constants of the
  // simple solid-color-with-border design (changing them doesn't change
  // appearance because the texture stretches to the roof face anyway),
  // so they stay inline.
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = opts.roofColor;
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = opts.borderColor;
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, 124, 124);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = facade.ANISOTROPY;
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
export function createBuildingMesh(building: Building): THREE.Mesh {
  const w = building.w;
  const d = building.d;
  const shading = SHADING;
  const color = building.color;

  // Floor count + height come straight from layout (layout is the source of
  // truth for the lines→floors mapping and snaps h to floor_height boundaries).
  const floors = Math.max(1, building.floors || 1);
  const renderH = building.h;

  // Scene convention: Three.js Y is up. Layout coords (x, y) map to scene
  // (x, z) with building height along scene-Y. So a BoxGeometry(w, renderH, d)
  // has its sides running along world-X and world-Z — exactly what we want.
  //
  // BoxGeometry material order: [+X, -X, +Y, -Y, +Z, -Z]
  // Window-column counts scale with each face's horizontal extent:
  //   ±X faces (east/west walls)   have horizontal extent = d
  //   ±Z faces (north/south walls) have horizontal extent = w
  const colsEW = Math.max(
    1,
    Math.min(FACADE.WINDOW_COLS_MAX, Math.floor(d / FACADE.WINDOW_COLS_SIZE_DIVISOR))
  );
  const colsNS = Math.max(
    1,
    Math.min(FACADE.WINDOW_COLS_MAX, Math.floor(w / FACADE.WINDOW_COLS_SIZE_DIVISOR))
  );

  // Palette — opposing faces share a color so the building looks symmetric
  // as the camera orbits. Front/back faces use a slight absolute lightness
  // bump; side faces use a MULTIPLICATIVE darkening so they always read as
  // proportionally darker than the front regardless of the base lightness,
  // with an absolute floor that keeps them from crushing to pure black on
  // dim files (old/untouched) and blending into the dark background.
  const wallFront = shadeAndShiftHue(
    color,
    shading.WALL_FRONT_LIGHTNESS_DELTA,
    shading.WALL_FRONT_HUE_SHIFT
  );
  const wallSide = shadeByRatio(
    color,
    shading.WALL_SIDE_DARKEN_RATIO,
    shading.WALL_SIDE_LIGHTNESS_DELTA,
    shading.WALL_SIDE_LIGHTNESS_FLOOR
  );
  const slabFront = shadeAndShiftHue(
    color,
    shading.SLAB_FRONT_LIGHTNESS_DELTA,
    shading.SLAB_FRONT_HUE_SHIFT
  );
  const slabSide = shadeByRatio(
    color,
    shading.SLAB_SIDE_DARKEN_RATIO,
    shading.SLAB_SIDE_LIGHTNESS_DELTA,
    shading.SLAB_SIDE_LIGHTNESS_FLOOR
  );
  const winColor = shadeColor(color, shading.WINDOW_LIGHTNESS_DELTA);
  const doorColor = shadeAndShiftHue(color, shading.DOOR_LIGHTNESS_DELTA, 0);
  const roofColor = color;
  const roofBorder = shadeAndShiftHue(color, shading.ROOF_BORDER_LIGHTNESS_DELTA, 0);

  // Door face mapping. Layout orient describes which face actually points at
  // the adjacent street; scene maps layout-y to scene-z.
  //   SOUTH → door on layout +y = scene +Z (material index 4)
  //   NORTH → door on layout -y = scene -Z (material index 5)
  //   EAST  → door on layout +x = scene +X (material index 0)
  //   WEST  → door on layout -x = scene -X (material index 1)
  const orient = building.orient || BuildingOrient.South;
  const doorOnEW = orient === BuildingOrient.East || orient === BuildingOrient.West;

  // Assign the lighter "front" palette to the pair of faces that contains
  // the door; the other pair gets the darker "side" palette.
  const wallNS = doorOnEW ? wallSide : wallFront;
  const wallEW = doorOnEW ? wallFront : wallSide;
  const slabNS = doorOnEW ? slabSide : slabFront;
  const slabEW = doorOnEW ? slabFront : slabSide;

  const geometry = new THREE.BoxGeometry(w, renderH, d);

  // Door world width = path connector width × DOOR_WIDTH_OF_PATH so the
  // door visually matches the path strip leading away from it. The path
  // strip is per-building (= w × PATH_WIDTH_FRAC).
  const doorWorldWidth = w * BUILDING_DIMENSIONS.get().PATH_WIDTH_FRAC * DOOR_WIDTH_OF_PATH;

  // One material per face, in BoxGeometry order: [+X, -X, +Y, -Y, +Z, -Z].
  // EW faces (east/west walls) span the building's depth `d`; NS faces span
  // its width `w`. faceWorldWidth tells the texture builder how to convert
  // the requested doorWorldWidth into pixels for this face's canvas.
  function facadeMat(
    cols: number,
    hasDoor: boolean,
    wallColor: string,
    slabColor: string,
    faceWorldWidth: number
  ): THREE.MeshBasicMaterial {
    const tex = _buildFacadeTexture({
      floors,
      cols,
      wallColor,
      slabColor,
      winColor,
      doorColor,
      hasDoor,
      faceWorldWidth,
      doorWorldWidth,
    });
    return new THREE.MeshBasicMaterial({ map: tex });
  }

  function roofMat(): THREE.MeshBasicMaterial {
    const tex = _buildRoofTexture({ roofColor, borderColor: roofBorder });
    return new THREE.MeshBasicMaterial({ map: tex });
  }

  function bottomMat(): THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial({ color: new THREE.Color(wallEW) });
  }

  // EW faces (±X walls) span the building's depth `d` along their canvas;
  // NS faces (±Z walls) span the width `w`. Pass each face's world width
  // through so the door texture can size itself in world units.
  const materials = [
    facadeMat(colsEW, orient === BuildingOrient.East, wallEW, slabEW, d), // +X (east)
    facadeMat(colsEW, orient === BuildingOrient.West, wallEW, slabEW, d), // -X (west)
    roofMat(), // +Y (roof)
    bottomMat(), // -Y (bottom)
    facadeMat(colsNS, orient === BuildingOrient.South, wallNS, slabNS, w), // +Z (south)
    facadeMat(colsNS, orient === BuildingOrient.North, wallNS, slabNS, w), // -Z (north)
  ];

  const mesh = new THREE.Mesh(geometry, materials);

  // Position: building center in XY plane, base sits on z=0.
  // We use Three.js default Y-up internally but position Y to be "up" in the
  // scene as well — the camera is set up for that. World-space mapping from
  // layout (x, y, z-up) to scene (x, y-up, z):
  //     scene.x = layout.x
  //     scene.y = layout.z (height)
  //     scene.z = layout.y
  mesh.position.set(building.x, renderH / 2, building.y);

  mesh.userData.building = building;
  mesh.userData.type = NodeKind.File;
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
function _flatMat(color: string | number, renderOrderLayer: number): THREE.MeshBasicMaterial {
  const mat = new THREE.MeshBasicMaterial({
    color,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -renderOrderLayer,
    polygonOffsetUnits: -renderOrderLayer,
  });
  mat.userData.renderOrderLayer = renderOrderLayer;
  return mat;
}

// -----------------------------------------------------------------------------
// _buildStadiumGeometry(length, width, orientation, capStyle) -> ShapeGeometry
//
// A pill / stadium / rectangle-with-rounded-ends shape, lying in the XY
// plane (intended to be rotated -π/2 around X to lie flat on world XZ).
// `orientation` picks which 2D axis the long direction runs along.
//
// `capStyle` controls which ends are rounded:
//   'both' — semicircular caps at both ends (the classic pill; used for
//            the root street, which has no parent intersection)
//   'high' — rounded only at the +length end; flat at the −length end
//            (used by non-root children whose joining endpoint is at
//            local low — they merge cleanly into the parent there)
//   'low'  — rounded only at the −length end; flat at the +length end
//
// In all three cases the shape's extent along the long axis is exactly
// `length`, centered at 0, so the caller's positioning math doesn't
// change with cap style.
// -----------------------------------------------------------------------------
function _buildStadiumGeometry(
  length: number,
  width: number,
  orientation: StreetAxis,
  capStyle: CapStyle
): THREE.ShapeGeometry {
  capStyle = capStyle || 'both';
  // capStyle is specified in WORLD-axis terms ('low' = round the world-low
  // end, 'high' = the world-high end). The mesh is rotated -π/2 around X
  // to lie flat: local x maps directly to world X (no flip), but local y
  // maps to world -z (flipped). So for y-orient streets, "world low" is
  // at LOCAL HIGH and vice versa — invert capStyle here so the geometry
  // construction below stays in plain local-axis terms.
  if (orientation === StreetAxis.Y) {
    if (capStyle === 'low') capStyle = 'high';
    else if (capStyle === 'high') capStyle = 'low';
  }
  const r = width / 2;
  const roundLow = capStyle === 'both' || capStyle === 'low';
  const roundHigh = capStyle === 'both' || capStyle === 'high';
  // The straight section's long-axis range. When a side is rounded, the
  // straight section ends r before the world edge; when flat, it extends
  // all the way out to the world edge.
  let lo = roundLow ? -length / 2 + r : -length / 2;
  let hi = roundHigh ? length / 2 - r : length / 2;
  if (lo > hi) lo = hi = 0; // degenerate: width > length, collapse to 0

  const shape = new THREE.Shape();
  if (orientation === StreetAxis.X) {
    // Trace counter-clockwise: start at low-bottom corner, run along the
    // bottom edge, round (or flat) the high end, run back along the top,
    // and round (or flat) the low end. Auto-closes back to start.
    shape.moveTo(lo, -r);
    shape.lineTo(hi, -r);
    if (roundHigh) shape.absarc(hi, 0, r, -Math.PI / 2, Math.PI / 2, false);
    else shape.lineTo(hi, r);
    shape.lineTo(lo, r);
    if (roundLow) shape.absarc(lo, 0, r, Math.PI / 2, (3 * Math.PI) / 2, false);
    else shape.lineTo(lo, -r);
  } else {
    shape.moveTo(-r, lo);
    if (roundLow) shape.absarc(0, lo, r, Math.PI, 2 * Math.PI, false);
    else shape.lineTo(r, lo);
    shape.lineTo(r, hi);
    if (roundHigh) shape.absarc(0, hi, r, 0, Math.PI, false);
    else shape.lineTo(-r, hi);
  }
  return new THREE.ShapeGeometry(shape, STADIUM_SEGMENTS);
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
function createStreetMesh(street: StreetWithJoin, yBase: number): THREE.Group {
  const asphaltCfg = ASPHALT.get();
  const sidewalkCfg = SIDEWALK_COLORS.get();
  const group = new THREE.Group();
  const asphaltWidth = street.width * asphaltCfg.WIDTH_FRAC;
  // For concentric caps the asphalt must be shorter by exactly the sidewalk
  // strip width (= (width - asphaltWidth) / 2 per side). That makes the two
  // cap circles share a center and the annular sidewalk strip keep constant
  // thickness around the curve — the cap stays correctly rounded at any
  // street length. Floor at 0 so degenerate streets don't try to render
  // a negative-length stadium.
  const sidewalkStrip = (street.width - asphaltWidth) / 2;
  const asphaltLength = Math.max(0, street.length - 2 * sidewalkStrip);

  // Cap style: the root has rounded caps both sides; non-root streets are
  // FLAT at their joining end (so they merge cleanly into the parent at
  // the T-intersection) and rounded only at the open end. layout.js stamps
  // each non-root street with `joinSide` ('low' | 'high') after layout.
  // Same capStyle is passed to BOTH sidewalk + asphalt so their flat ends
  // line up and the visible sidewalk strip stays uniform around the cap.
  let capStyle: CapStyle;
  if (street.isRoot) capStyle = 'both';
  else if (street.joinSide === 'high')
    capStyle = 'low'; // round the low/open end
  else capStyle = 'high'; // round the high/open end

  // Sidewalk — the clickable target for street picking. renderOrder=1
  // means all sidewalks across the city draw first, as a single bottom layer.
  const orders = RENDER_ORDERS;
  const sidewalk = new THREE.Mesh(
    _buildStadiumGeometry(street.length, street.width, street.orientation, capStyle),
    _flatMat(sidewalkCfg.DEFAULT, orders.SIDEWALK)
  );
  sidewalk.rotation.x = -Math.PI / 2;
  sidewalk.position.set(street.x, yBase, street.y);
  sidewalk.renderOrder = orders.SIDEWALK;
  sidewalk.userData.street = street;
  sidewalk.userData.type = NodeKind.Directory;
  group.add(sidewalk);

  // Asphalt — narrower, always draws on top of every sidewalk.
  const asphalt = new THREE.Mesh(
    _buildStadiumGeometry(asphaltLength, asphaltWidth, street.orientation, capStyle),
    _flatMat(asphaltCfg.COLOR, orders.ASPHALT)
  );
  asphalt.rotation.x = -Math.PI / 2;
  asphalt.position.set(street.x, yBase, street.y);
  asphalt.renderOrder = orders.ASPHALT;
  group.add(asphalt);

  group.userData.street = street;
  group.userData.sidewalk = sidewalk; // exposed so callers can pick on it
  group.userData.asphalt = asphalt; // exposed for live theme recolor
  group.userData.type = NodeKind.Directory;
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
// 8 gem faces in a PRISMATIC palette (sourced from defaults.js) — high-
// saturation hues spaced around the color wheel so no face blends with
// nearby building colors and the gem reads as an unambiguous "root"
// beacon regardless of what's around it.
function createRootGem(street: Street): THREE.Group {
  const sizing = GEM_SIZING.get();
  const appearance = GEM_APPEARANCE.get();
  const edgeColor = appearance.EDGE_COLOR;
  const group = new THREE.Group();

  // Gem size scales with the street's width. The layout reserves extra dead
  // space at the root street's origin end (see GEM_SIZING), so the origin
  // cap has no buildings overlapping it — the road's rounded cap IS the
  // plaza. RADIUS_AS_STREET_FRAC MUST match what layout.js uses to reserve
  // that pad.
  const radiusFrac = sizing.RADIUS_AS_STREET_FRAC;
  const minRadius = sizing.MIN_RADIUS;
  const hoverFrac = sizing.HOVER_LIFT_FRAC;
  const bobFrac = GEM_ANIMATION.get().BOB_AMPLITUDE_FRAC;

  let radius = street.width * radiusFrac;
  if (radius < minRadius) radius = minRadius;
  const hoverY = radius + street.width * hoverFrac;

  // Gem hovers at the center of the road's origin-end cap. For a stadium of
  // length L and width W, the origin cap circle is centered at a distance
  // W/2 inward from the tip.
  let gemX: number, gemZ: number;
  if (street.orientation === StreetAxis.X) {
    gemX = street.x - street.length / 2 + street.width / 2;
    gemZ = street.y;
  } else {
    gemX = street.x;
    gemZ = street.y - street.length / 2 + street.width / 2;
  }

  // ---- Gem: per-face colored octahedron -------------------------------------
  const geo = new THREE.OctahedronGeometry(radius, 0);
  const faces = GEM_FACE_PALETTE.get();
  const colorAttr = new Float32Array(geo.attributes.position.count * 3);
  for (let f = 0; f < faces.length; f++) {
    const fc = faces[f];
    for (let v = 0; v < 3; v++) {
      const idx = (f * 3 + v) * 3;
      colorAttr[idx] = fc[0];
      colorAttr[idx + 1] = fc[1];
      colorAttr[idx + 2] = fc[2];
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colorAttr, 3));

  const body = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: appearance.BODY_OPACITY,
      depthWrite: false,
    })
  );

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geo),
    new THREE.LineBasicMaterial({ color: new THREE.Color(edgeColor) })
  );

  const gem = new THREE.Group();
  gem.add(body);
  gem.add(edges);
  gem.position.set(gemX, hoverY, gemZ);
  gem.userData.baseY = hoverY;
  gem.userData.bobAmp = radius * bobFrac;
  gem.userData.type = NodeKind.Gem;
  // Stashed for live applyTheme updates of HOVER_LIFT_FRAC: needed to
  // recompute baseY = radius + streetWidth × frac.
  gem.userData.streetWidth = street.width;
  gem.userData.radius = radius;

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
function createPathMesh(
  path: BuildingPath,
  yBase: number
): THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> {
  // Paths sit between sidewalks and asphalts so they extend the sidewalk
  // all the way to the building without overdrawing the asphalt.
  const pathOrder = RENDER_ORDERS.PATH_CONNECTOR;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(path.w, path.d),
    _flatMat(SIDEWALK_COLORS.get().DEFAULT, pathOrder)
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(path.x, yBase, path.y);
  mesh.renderOrder = pathOrder;
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
// regenerateLabelTexture(group) — rebuild a single label's CanvasTexture
// from the current LABEL_TYPOGRAPHY.FILL / STROKE / FONT settings, swap
// it onto the existing plane material, and dispose the old one. Used by
// applyTheme to make the label fill color hot-reloadable without a full
// rebuild. Only safe to call when canvas dimensions haven't changed —
// FILL/STROKE colors are fine, but font-size / padding / stroke-width
// changes the texture aspect, which would also need a plane geometry
// update (those keys stay rebuild-required).
export function regenerateLabelTexture(group: THREE.Group): void {
  const street = group && group.userData && group.userData.street;
  if (!street || !street.label) return;
  const plane = group.children && (group.children[0] as THREE.Mesh);
  if (!plane || !plane.material) return;
  const mat = plane.material as THREE.MeshBasicMaterial;
  if (mat.map) mat.map.dispose();
  const info = _buildLabelTexture(street.label);
  mat.map = info.texture;
  mat.needsUpdate = true;
  group.userData.textureAspect = info.aspect;
}

function _buildLabelTexture(text: string): { texture: THREE.CanvasTexture; aspect: number } {
  // High source resolution so close-zoom doesn't reveal bilinear blur.
  // The world-space plane size is unchanged — we're just packing more
  // texels into the same footprint.
  const label = LABEL_TYPOGRAPHY.get();
  const fontSpec = `${label.FONT_WEIGHT} ${label.FONT_SIZE_PX}px ${label.FONT_FAMILY}`;
  const measure = document.createElement('canvas').getContext('2d')!;
  measure.font = fontSpec;
  const textW = Math.ceil(measure.measureText(text).width);
  const canvas = document.createElement('canvas');
  canvas.width = textW + label.CANVAS_PADDING_PX * 2;
  canvas.height = label.FONT_SIZE_PX + label.CANVAS_PADDING_PX * 2;
  const ctx = canvas.getContext('2d')!;
  ctx.font = fontSpec;
  ctx.textAlign = LABEL_TEXT_ALIGN as CanvasTextAlign;
  ctx.textBaseline = LABEL_TEXT_BASELINE as CanvasTextBaseline;

  ctx.lineWidth = label.STROKE_WIDTH_PX;
  ctx.strokeStyle = label.STROKE;
  ctx.strokeText(text, canvas.width / 2, canvas.height / 2);
  ctx.fillStyle = label.FILL;
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = LABEL_ANISOTROPY;
  return { texture: tex, aspect: canvas.width / canvas.height };
}

function createStreetLabels(street: Street): THREE.Group[] {
  const text = street.label || '';
  if (!text) return [];

  const label = LABEL_TYPOGRAPHY.get();
  const orders = RENDER_ORDERS;
  const info = _buildLabelTexture(text);

  // Label sizing scales with street width — narrow alleys get small text,
  // wide boulevards get large text — so the label always fits its asphalt
  // and reads at a consistent proportion of the street it's labeling.
  const worldH = street.width * label.HEIGHT_FRAC;
  const worldW = worldH * info.aspect;

  // Repetition: spacing scales with the label's own rendered width so long
  // names ("codecity") don't pile up on wide streets while short names
  // ("src") still repeat often enough to always have one near the viewport.
  // A minimum floor keeps tiny labels from repeating every few units.
  const spacing = Math.max(worldW * label.SPACING_MULT, label.SPACING_FLOOR);
  const count = Math.max(1, Math.floor(street.length / spacing));

  const labels: THREE.Group[] = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : (i + 0.5) / count;
    const offset = (t - 0.5) * street.length;
    let sx = street.x,
      sz = street.y;
    if (street.orientation === StreetAxis.X) sx += offset;
    else sz += offset;

    const mat = new THREE.MeshBasicMaterial({
      map: info.texture,
      transparent: true,
      // Don't write depth — otherwise the plane's transparent canvas pixels
      // z-block the neon path running underneath, leaving a visible
      // bbox-shaped hole. With depthWrite off, opaque glyph pixels still
      // alpha-blend over the path, but letter loops (O, D, P) reveal it.
      depthWrite: false,
    });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(worldW, worldH), mat);
    plane.rotation.x = -Math.PI / 2; // lay flat
    // Render AFTER the neon path line so the label composites on top.
    plane.renderOrder = orders.STREET_LABEL;

    // Wrap in a group so we can apply a single rotation.y for camera-follow
    // flipping without fighting the Euler order of the flattened plane.
    const group = new THREE.Group();
    group.add(plane);
    // Lift a tiny amount off the asphalt to avoid coplanar z-fighting, while
    // staying well below building tops so buildings still occlude the label.
    group.position.set(sx, label.ELEVATION, sz);
    // Base rotation per orientation. For y-streets the label's reading
    // direction needs to run along scene-Z, so rotate the group 90°.
    group.userData.baseRotY = street.orientation === StreetAxis.Y ? -Math.PI / 2 : 0;
    group.rotation.y = group.userData.baseRotY;
    group.userData.street = street;
    group.userData.type = NodeKind.Label;
    // Stashed for live applyTheme updates: ELEVATION (group.position.y),
    // and HEIGHT_FRAC (plane.scale recomputed from streetWidth × frac).
    group.userData.streetWidth = street.width;
    group.userData.textureAspect = info.aspect;
    group.userData.origHeightFrac = label.HEIGHT_FRAC;
    labels.push(group);
  }
  return labels;
}

export function buildCityScene(layout: CityLayout) {
  // All visual values (street colors, sidewalk default, label fill/stroke,
  // gem edge color, etc.) come from the named exports of src/defaults.js
  // imported at the top of this module. No per-call config plumbing.

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SCENE_COLORS.get().GROUND);

  // Streets + their labels
  const streets = layout.streets || [];
  type FlatMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  const streetPickables: FlatMesh[] = [];
  const asphaltMeshes: FlatMesh[] = [];
  const streetLabels: THREE.Group[] = [];
  let rootGem: THREE.Group | null = null;
  let rootGemBody: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> | null = null;
  let rootGemEdges: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial> | null = null;
  for (const street of streets) {
    const sg = createStreetMesh(street, 0);
    scene.add(sg);
    streetPickables.push(sg.userData.sidewalk as FlatMesh);
    if (sg.userData.asphalt) asphaltMeshes.push(sg.userData.asphalt as FlatMesh);

    const labels = createStreetLabels(street);
    for (const label of labels) {
      scene.add(label);
      streetLabels.push(label);
    }

    // Root-of-repo landmark at the street's origin end. The gem group
    // wraps two children: [0] body (the colored octahedron) and [1]
    // edges (the dark separator lines). Both are exposed so the Settings
    // UI can hot-update color + opacity.
    if (street.isRoot) {
      const gemGroup = createRootGem(street);
      scene.add(gemGroup);
      rootGem = (gemGroup.userData.gem as THREE.Group) || null;
      if (rootGem && rootGem.children) {
        rootGemBody =
          (rootGem.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>) ||
          null;
        rootGemEdges =
          (rootGem.children[1] as THREE.LineSegments<
            THREE.BufferGeometry,
            THREE.LineBasicMaterial
          >) || null;
      }
    }
  }

  // Paths
  const pathMeshes: FlatMesh[] = [];
  const paths = layout.paths || [];
  for (const path of paths) {
    const pm = createPathMesh(path, 0);
    scene.add(pm);
    pathMeshes.push(pm);
  }

  // Buildings
  const buildingMeshes: THREE.Mesh[] = [];
  const buildings = layout.buildings || [];
  for (const b of buildings) {
    if (b.file && (b.file.type as string) === 'directory') continue;
    const mesh = createBuildingMesh(b);
    scene.add(mesh);
    buildingMeshes.push(mesh);
  }

  // Bounding box of the whole city (in scene coords). Used by the caller to
  // frame the camera.
  const bbox = new THREE.Box3().setFromObject(scene);
  if (bbox.isEmpty()) {
    bbox.set(new THREE.Vector3(-50, 0, -50), new THREE.Vector3(50, 10, 50));
  }

  return {
    scene,
    buildingMeshes,
    streetPickables,
    streetLabels,
    pathMeshes,
    asphaltMeshes,
    rootGem,
    rootGemBody,
    rootGemEdges,
    bbox,
  };
}
