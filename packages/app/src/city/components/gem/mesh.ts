// city/components/gem/mesh.ts — root gem STRUCTURE factory (index.ts owns
// reactivity, animation, disposal). One gem per scene, hovering over the
// root street's origin-end cap — the layout reserves that dead space as its
// plaza, so no separate pad mesh exists.

import * as THREE from 'three';
import { GEM, GEM_SIZING } from '@/state/settings/fields/gem';
import { type GemSizingConfig } from '@codecity/city';
import { NEUTRAL_POLYGON_OFFSET } from '@/city/utils/neutralPolygonOffset';
import { BYTE_MAX } from '@/city/utils/bufferLayout';
import { gemAnchorXZ } from './anchor';
import { paletteColors, writeFaceColors } from './palette';
import { buildGemGeometry } from './shapes';
import { NodeKind, Street } from '@codecity/city';

// Hover-lift as a fraction of street width — fixed, not user-tunable;
// index.ts recomputes baseY from it on Save.
export const GEM_HOVER_LIFT_FRAC = 0.5;

// Glow falloff baked into a DataTexture — NOT a canvas-2D gradient: Android
// rounds low-alpha stops non-zero, and additive blending shows the box.

// (radiusFraction, alpha) stops, linearly interpolated: fuzzy haze, by eye.
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

/** One city's gem textures. A DataTexture is uploaded to the context that
 *  created it, so two cities cannot share the cache. */
export interface GemTextures {
  glow(): THREE.DataTexture;
  dispose(): void;
}

export function createGemTextures(): GemTextures {
  let glow: THREE.DataTexture | null = null;
  return {
    glow(): THREE.DataTexture {
      if (!glow) glow = _buildGlowTexture();
      return glow;
    },
    dispose(): void {
      glow?.dispose();
      glow = null;
    },
  };
}

function _buildGlowTexture(): THREE.DataTexture {
  // Texture is square, RGBA, and sized so the falloff has room to read smooth
  // at the halo's on-screen size.
  const SIZE = 256;
  const RGBA_CHANNELS = 4;
  const data = new Uint8Array(SIZE * SIZE * RGBA_CHANNELS);
  const center = (SIZE - 1) / 2;
  const radius = SIZE / 2;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const t = Math.hypot(x - center, y - center) / radius;
      const alpha = Math.round(_glowAlphaAt(Math.min(t, 1)) * BYTE_MAX);
      const i = (y * SIZE + x) * RGBA_CHANNELS;
      data[i] = BYTE_MAX;
      data[i + 1] = BYTE_MAX;
      data[i + 2] = BYTE_MAX;
      // Quantized-to-zero rim: anything rounding below one step IS zero, so
      // the quad's edges can never glow the sky.
      data[i + 3] = alpha;
    }
  }
  const tex = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

// Builds the gem at the street's origin-end cap; the inner gem lives at
// group.userData.gem. Size must match the radius the layout reserves.
/** The gem's radius: it scales with the street it sits on. layout/algorithm.ts
 *  reserves the origin-cap plaza from the same signal, so the two agree. */
export function gemRadiusFor(streetWidth: number, sizing: GemSizingConfig): number {
  return Math.max(streetWidth * sizing.RADIUS_AS_STREET_FRAC, sizing.MIN_RADIUS);
}

export function createRootGem(street: Street, textures: GemTextures): THREE.Group {
  const sizing = GEM_SIZING.value;
  const appearance = GEM.value;
  const edgeColor = appearance.EDGE_COLOR;
  const group = new THREE.Group();

  const hoverFrac = GEM_HOVER_LIFT_FRAC;
  const radius = gemRadiusFor(street.width, sizing);
  const hoverY = radius + street.width * hoverFrac;

  // Shared gemAnchorXZ helper keeps this in lockstep with treePlacement's
  // scatter center.
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
      // ON so the gem occludes road labels behind it (OFF looked jewel-like
      // but let labels bleed through).
      depthWrite: true,
    })
  );
  // The picker raycasts the body mesh directly, so the type flag must live
  // HERE or gem hover/click silently never fires.
  body.userData.type = NodeKind.Gem;

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geo),
    new THREE.LineBasicMaterial({ color: new THREE.Color(edgeColor) })
  );

  // Halo: two PlaneGeometry quads (hot core + atmosphere), NOT THREE.Sprite
  // — a specialized GPU path some mobile drivers corrupt into flashes.
  const gem = new THREE.Group();
  const glowCfg = GEM.value;
  const glowTex = textures.glow();
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
      // ON: glow visible THROUGH canopies (OFF) is a worse artifact than
      // the island slicing it at low angles.
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
      // OFF on the OUTER halo only: depth-tested, the island slices this
      // big quad harshly; it's too dim for bleed-through to read.
      depthTest: false,
      ...NEUTRAL_POLYGON_OFFSET,
    })
  );
  outerGlow.scale.set(radius * glowCfg.GLOW_OUTER_SCALE, radius * glowCfg.GLOW_OUTER_SCALE, 1);
  outerGlow.visible = glowCfg.GLOW_ENABLED;
  outerGlow.raycast = () => {};

  // Outer halo → inner → opaque body → edges, so the additive layers blend
  // cumulatively beneath the colored faces.
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
  // Direct refs so consumers never depend on the child-order convention.
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
