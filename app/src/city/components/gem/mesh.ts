// city/components/gem/mesh.ts — The root gem MESH BUILDER. Builds a
// floating, slowly-spinning polyhedron with per-face vertex colors and a
// two-layer additive sprite halo. This is the PRIVATE structure factory;
// the public door is index.ts (createGem), which owns the gem's
// settings-reactivity, per-frame animation, and disposal.
//
// One gem per scene: it marks the layout's root street as the "you are
// here" beacon. Hovers above the ORIGIN-END cap of the root street;
// the layout reserves dead space at that end so the rounded cap acts
// as the gem's plaza (no separate pad mesh).
//
// Animation: the createGem component reads `gem.userData.{baseY,radius,…}`
// and applies per-frame rotation + bob + glow-color cycling. This module
// just builds the static structure; mutation lives in index.ts.

import * as THREE from 'three';
import { GEM, GEM_SIZING } from '@/state/stores/settings/gem';
import { NEUTRAL_POLYGON_OFFSET } from '@/city/utils/neutralPolygonOffset';
import { NodeKind } from '@/types';
import { gemAnchorXZ } from './anchor';
import { paletteColors, writeFaceColors } from './palette';
import { buildGemGeometry } from './shapes';
import type { Street } from '@/types';

// Gem hover-lift as a fraction of street width — fixed, not user-tunable
// (was in GEM_SIZING but never exposed as a control). Used by the gem
// component (index.ts) to recompute baseY on Save.
export const GEM_HOVER_LIFT_FRAC = 0.5;

// Procedural glow texture: a radial falloff computed pixel-by-pixel into a
// DataTexture. Deliberately NOT a canvas-2D gradient: Android's canvas
// rasterizes low-alpha gradient stops with premultiplied rounding that
// leaves the "transparent" region slightly non-zero, and under additive
// blending that renders the sprite's square edges as a visible box over
// the night sky (desktop canvases round the same texels to true zero).
// Cached at module scope so a second gem build (manifest swap on rebuild)
// reuses the same GPU texture rather than allocating a fresh one each time.

// Falloff stops as (radiusFraction, alpha) pairs, linearly interpolated:
// softer than a typical hard-core radial — even the center is held a
// little below max alpha, and most of the area is at very low opacity so
// the halo reads as a fuzzy haze rather than a bright disk. Tuned by eye.
const GLOW_FALLOFF_STOPS: ReadonlyArray<readonly [number, number]> = [
  [0, 0.85],
  [0.08, 0.55],
  [0.2, 0.3],
  [0.4, 0.12],
  [0.65, 0.04],
  [0.85, 0.01],
  [1, 0],
];

function _glowAlphaAt(t: number): number {
  for (let i = 1; i < GLOW_FALLOFF_STOPS.length; i++) {
    const [t1, a1] = GLOW_FALLOFF_STOPS[i];
    if (t <= t1) {
      const [t0, a0] = GLOW_FALLOFF_STOPS[i - 1];
      return a0 + ((t - t0) / (t1 - t0)) * (a1 - a0);
    }
  }
  return 0;
}

let _glowTexture: THREE.DataTexture | null = null;
function _makeGlowTexture(): THREE.DataTexture {
  if (_glowTexture) return _glowTexture;
  const SIZE = 256;
  const data = new Uint8Array(SIZE * SIZE * 4);
  const center = (SIZE - 1) / 2;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const t = Math.hypot(x - center, y - center) / (SIZE / 2);
      const alpha = Math.round(_glowAlphaAt(Math.min(t, 1)) * 255);
      const i = (y * SIZE + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      // Quantized-to-zero rim: anything that would round below 1/255 IS
      // zero, so the quad's edges can never glow the sky.
      data[i + 3] = alpha;
    }
  }
  _glowTexture = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat);
  _glowTexture.magFilter = THREE.LinearFilter;
  _glowTexture.minFilter = THREE.LinearFilter;
  _glowTexture.needsUpdate = true;
  return _glowTexture;
}

// createRootGem(street) -> THREE.Group
//
// Builds the gem at the origin-end cap of `street`. Returns the outer
// group; the inner gem (with body, edges, glow sprites) is at
// `group.userData.gem`. Per-face colors come from GEM_FACE_PALETTE;
// size scales with the street's width (must match the radius the
// layout reserves — see GEM_SIZING).
export function createRootGem(street: Street): THREE.Group {
  const sizing = GEM_SIZING.value;
  const appearance = GEM.value;
  const edgeColor = appearance.EDGE_COLOR;
  const group = new THREE.Group();

  // Size scales with street width. layout/algorithm.ts reserves the origin-cap
  // plaza from this same GEM_SIZING signal, so the two agree by construction.
  const radiusFrac = sizing.RADIUS_AS_STREET_FRAC;
  const minRadius = sizing.MIN_RADIUS;
  const hoverFrac = GEM_HOVER_LIFT_FRAC;

  let radius = street.width * radiusFrac;
  if (radius < minRadius) radius = minRadius;
  const hoverY = radius + street.width * hoverFrac;

  // Gem hovers at the center of the road's origin-end cap. Shared
  // helper so this stays in lockstep with treePlacement's scatter
  // center — both consume the same anchor.
  const anchor = gemAnchorXZ(street);
  const gemX = anchor.x;
  const gemZ = anchor.y;

  // ---- Gem: per-face colored polyhedron -------------------------------------
  const geo = buildGemGeometry(GEM.value.SIDES, radius);

  const faceColors = paletteColors(GEM.value);

  const vertexCount = geo.attributes.position.count;
  const colorAttr = new Float32Array(vertexCount * 3);
  writeFaceColors(colorAttr, faceColors);
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
  // Picker raycasts against the body mesh directly (not the parent
  // group), so the type flag has to live here for hover/click detection
  // to fire. Without this, `hit.object.userData.type === NodeKind.Gem`
  // in inputHandlers / interpretHit silently always evaluates to false.
  body.userData.type = NodeKind.Gem;

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geo),
    new THREE.LineBasicMaterial({ color: new THREE.Color(edgeColor) })
  );

  // Neon glow: two billboarded quads stacked behind the gem with a soft
  // radial-gradient alpha texture. Plain PlaneGeometry meshes, NOT
  // THREE.Sprite: the sprite pipeline is a specialized GPU path that some
  // mobile drivers corrupt (screen-covering flashes in the halo's palette
  // colors); a vanilla mesh takes the same draw path as every building.
  // createGem's tick() orients them at the camera each frame. Additive
  // blending makes the bright center clip toward white where it overlaps
  // the colored gem, mimicking a real light source. Sizes are world units
  // (radius × INNER/OUTER_SCALE) so the halo scales with the gem.
  //
  // Two layers:
  //   - inner: smaller, brighter — a "hot core" that hugs the gem
  //   - outer: much larger, dimmer — the atmospheric falloff
  //
  // Material refs are stashed on gem.userData so the theme effect + the render
  // loop can mutate scale/opacity/color without rebuilding. Glow visibility
  // is driven by the GEM_GLOW.ENABLED flag.
  const gem = new THREE.Group();
  const glowCfg = GEM.value;
  const glowTex = _makeGlowTexture();
  const glowQuadGeo = new THREE.PlaneGeometry(1, 1);
  const innerGlow = new THREE.Mesh(
    glowQuadGeo,
    new THREE.MeshBasicMaterial({
      map: glowTex,
      color: new THREE.Color(edgeColor),
      transparent: true,
      opacity: glowCfg.GLOW_INNER_OPACITY,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      // Depth test ON: the halo must be occluded by opaque foreground
      // surfaces (trees, buildings) instead of bleeding through them.
      // A prior version had this off so the glow wouldn't be sliced by
      // the island top at low camera angles, but the trade — gem glow
      // visible THROUGH tree canopies — is the more obvious artifact.
      depthTest: true,
      ...NEUTRAL_POLYGON_OFFSET,
    })
  );
  innerGlow.scale.set(radius * glowCfg.GLOW_INNER_SCALE, radius * glowCfg.GLOW_INNER_SCALE, 1);
  innerGlow.visible = glowCfg.GLOW_ENABLED;
  // Glow is purely visual — never absorbs hover / click. Meshes are
  // raycast-pickable by default, so override with a no-op.
  innerGlow.raycast = () => {};

  const outerGlow = new THREE.Mesh(
    glowQuadGeo,
    new THREE.MeshBasicMaterial({
      map: glowTex,
      color: new THREE.Color(edgeColor),
      transparent: true,
      opacity: glowCfg.GLOW_OUTER_OPACITY,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      // Depth test OFF on the OUTER halo only: this big atmospheric
      // quad extends far enough that the island silhouette slices it
      // in a harsh line at low camera angles when depth-tested. It's
      // dim/diffuse enough that the canopy bleed-through (the reason
      // depth-test is ON for the inner quad) is barely visible here.
      // The inner quad keeps depthTest: true so the bright core still
      // gets occluded behind buildings/trees correctly.
      depthTest: false,
      ...NEUTRAL_POLYGON_OFFSET,
    })
  );
  outerGlow.scale.set(radius * glowCfg.GLOW_OUTER_SCALE, radius * glowCfg.GLOW_OUTER_SCALE, 1);
  outerGlow.visible = glowCfg.GLOW_ENABLED;
  outerGlow.raycast = () => {};

  // Draw outer halo first (largest, softest), then inner, then the
  // opaque body, then the edges. The additive layers blend cumulatively
  // beneath the body's colored faces.
  gem.add(outerGlow);
  gem.add(innerGlow);
  gem.add(body);
  gem.add(edges);
  gem.position.set(gemX, hoverY, gemZ);
  gem.userData.baseY = hoverY;
  gem.userData.type = NodeKind.Gem;
  // Stashed for live theme updates of HOVER_LIFT_FRAC: needed to
  // recompute baseY = radius + streetWidth × frac.
  gem.userData.streetWidth = street.width;
  gem.userData.radius = radius;
  // Direct refs to the body and edges meshes so consumers (picker, theme
  // effect) don't have to know the child-order convention — which
  // shifts depending on whether the glow sprites are also children.
  gem.userData.body = body;
  gem.userData.edges = edges;
  // Glow quad refs for theme updates on Save, per-frame color cycling,
  // and the per-frame camera-facing orientation.
  gem.userData.innerGlow = innerGlow;
  gem.userData.outerGlow = outerGlow;

  group.add(gem);
  group.userData.gem = gem;
  return group;
}
