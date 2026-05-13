// engine.ts — Three.js scene builder. Turns layout output into a Scene of meshes.
//
// World axes: X east-west, Y north-south, Z up. Streets are flat planes.
// The root of the tree gets a spinning gold octahedron on a plaza.
//
// NOTE(Task 8): createBuildingMesh, _buildFacadeTexture, and _buildRoofTexture
// have been removed. Buildings are now rendered as per-block InstancedMeshes
// via web/scene/instanced/buildings.ts. buildCityScene still builds per-building
// meshes internally (so layout positions are available) but cityScene.ts removes
// them immediately and replaces them with InstancedMeshes.

import * as THREE from 'three';
import {
  SCENE_COLORS,
  ASPHALT,
  SIDEWALK_COLORS,
  LABEL_TYPOGRAPHY,
  GEM_SIZING,
  GEM_FACE_PALETTE,
  GEM_APPEARANCE,
  GEM_GLOW,
  GEM_ANIMATION,
} from '@/config/index.js';
import { RENDER_ORDERS } from '@/constants';
import { CapStyle, JoinSide, NodeKind, StreetAxis } from '@/types';
import type { BuildingPath, CityLayout, Street } from '@/types';

// Internal-only types for engine helpers.
type StreetWithJoin = Street & { joinSide?: JoinSide };

// ─── Renderer-internal constants (not designer-tunable) ────────────────────

// Stadium-cap tessellation count for the asphalt + sidewalk shapes.
const STADIUM_SEGMENTS = 16;

// Label canvas drawing internals — must stay 'center'/'middle' for the
// centered draw math, and label texture filtering anisotropy.
const LABEL_TEXT_ALIGN = 'center';
const LABEL_TEXT_BASELINE = 'middle';
const LABEL_ANISOTROPY = 16;

// -----------------------------------------------------------------------------
// Ground-plane materials — all the flat pieces (sidewalk, asphalt, paths)

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
  capStyle = capStyle || CapStyle.Both;
  // capStyle is specified in WORLD-axis terms (Low = round the world-low
  // end, High = the world-high end). The mesh is rotated -π/2 around X
  // to lie flat: local x maps directly to world X (no flip), but local y
  // maps to world -z (flipped). So for y-orient streets, "world low" is
  // at LOCAL HIGH and vice versa — invert capStyle here so the geometry
  // construction below stays in plain local-axis terms.
  if (orientation === StreetAxis.Y) {
    if (capStyle === CapStyle.Low) capStyle = CapStyle.High;
    else if (capStyle === CapStyle.High) capStyle = CapStyle.Low;
  }
  const r = width / 2;
  const roundLow = capStyle === CapStyle.Both || capStyle === CapStyle.Low;
  const roundHigh = capStyle === CapStyle.Both || capStyle === CapStyle.High;
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
  // each non-root street with `joinSide` after layout.
  // Same capStyle is passed to BOTH sidewalk + asphalt so their flat ends
  // line up and the visible sidewalk strip stays uniform around the cap.
  let capStyle: CapStyle;
  if (street.isRoot) capStyle = CapStyle.Both;
  else if (street.joinSide === JoinSide.High)
    capStyle = CapStyle.Low; // round the low/open end
  else capStyle = CapStyle.High; // round the high/open end

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

// Procedural glow texture: a single-channel radial gradient drawn on a
// canvas, used as the alpha map for the gem's sprite halo. Cached at
// module scope so a second gem build (live-reload manifest swap) reuses
// the same GPU texture rather than allocating a fresh one each time.
//
// Returns null when the host environment can't build a real gradient
// (the jsdom canvas mock returns undefined from createRadialGradient).
// Callers skip the glow sprites in that case.
let _glowTexture: THREE.CanvasTexture | null = null;
function _makeGlowTexture(): THREE.CanvasTexture | null {
  if (_glowTexture) return _glowTexture;
  const SIZE = 256;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx || typeof ctx.createRadialGradient !== 'function') return null;
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, SIZE / 2);
  if (!gradient || typeof gradient.addColorStop !== 'function') return null;
  // Softer, more gradual falloff than a typical hard-core radial: even the
  // center is held a little below max alpha, and most of the area is at
  // very low opacity so the halo reads as a fuzzy haze rather than a
  // bright disk. Tuned by eye for a "fuzzy neon glow" feel.
  gradient.addColorStop(0, 'rgba(255, 255, 255, 0.85)');
  gradient.addColorStop(0.08, 'rgba(255, 255, 255, 0.55)');
  gradient.addColorStop(0.2, 'rgba(255, 255, 255, 0.3)');
  gradient.addColorStop(0.4, 'rgba(255, 255, 255, 0.12)');
  gradient.addColorStop(0.65, 'rgba(255, 255, 255, 0.04)');
  gradient.addColorStop(0.85, 'rgba(255, 255, 255, 0.01)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, SIZE, SIZE);
  _glowTexture = new THREE.CanvasTexture(canvas);
  return _glowTexture;
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
      transparent: appearance.BODY_OPACITY < 1,
      opacity: appearance.BODY_OPACITY,
      // depthWrite must be on so the gem properly occludes road labels
      // (and anything else) drawn at lower elevation behind it. Prior
      // versions kept this off for "jewel-like" alpha blending; the
      // visual side-effect was labels bleeding through the gem.
      depthWrite: true,
    })
  );

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geo),
    new THREE.LineBasicMaterial({ color: new THREE.Color(edgeColor) })
  );

  // Neon glow: two billboarded sprites stacked behind the gem with a
  // soft radial-gradient alpha texture. Sprites always face the camera
  // so the glow reads consistently from any angle. Additive blending
  // makes the bright center clip toward white where it overlaps the
  // colored gem, mimicking a real light source. Sizes are world units
  // (radius × INNER/OUTER_SCALE) so the halo scales with the gem.
  //
  // Two layers:
  //   - inner: smaller, brighter — a "hot core" that hugs the gem
  //   - outer: much larger, dimmer — the atmospheric falloff
  //
  // Material refs are stashed on gem.userData so applyTheme + the render
  // loop can mutate scale/opacity/color without rebuilding. Glow visibility
  // is driven by the GEM_GLOW.ENABLED flag.
  //
  // Skipped when _makeGlowTexture returns null (jsdom test env).
  const gem = new THREE.Group();
  const glowCfg = GEM_GLOW.get();
  const glowTex = _makeGlowTexture();
  let innerGlowSprite: THREE.Sprite | null = null;
  let outerGlowSprite: THREE.Sprite | null = null;
  if (glowTex) {
    innerGlowSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTex,
        color: new THREE.Color(edgeColor),
        transparent: true,
        opacity: glowCfg.INNER_OPACITY,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    innerGlowSprite.scale.set(
      radius * glowCfg.INNER_SCALE,
      radius * glowCfg.INNER_SCALE,
      1
    );
    innerGlowSprite.visible = glowCfg.ENABLED;

    outerGlowSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTex,
        color: new THREE.Color(edgeColor),
        transparent: true,
        opacity: glowCfg.OUTER_OPACITY,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    outerGlowSprite.scale.set(
      radius * glowCfg.OUTER_SCALE,
      radius * glowCfg.OUTER_SCALE,
      1
    );
    outerGlowSprite.visible = glowCfg.ENABLED;

    // Draw outer halo first (largest, softest), then inner, then the
    // opaque body, then the edges. The additive layers blend cumulatively
    // beneath the body's colored faces.
    gem.add(outerGlowSprite);
    gem.add(innerGlowSprite);
  }
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
  // Glow sprite refs for hot-reload (applyTheme) and per-frame color
  // cycling. Either may be null when the host can't build a gradient
  // texture (jsdom test env).
  gem.userData.innerGlowSprite = innerGlowSprite;
  gem.userData.outerGlowSprite = outerGlowSprite;

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

  // Buildings are no longer built here — cityScene.ts removes any per-building
  // meshes immediately and replaces them with per-block InstancedMeshes
  // (Task 8). Return an empty array so cityScene.ts's disposal loop no-ops.
  const buildingMeshes: THREE.Mesh[] = [];

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
