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
import { NodeKind } from '@/types';
import { gemAnchorXZ } from './anchor';
import { paletteColors, writeFaceColors } from './palette';
import { buildGemGeometry } from './shapes';
import type { Street } from '@/types';

// Gem hover-lift as a fraction of street width — fixed, not user-tunable
// (was in GEM_SIZING but never exposed as a control). Used by the gem
// component (index.ts) to recompute baseY on Save.
export const GEM_HOVER_LIFT_FRAC = 0.5;

// Procedural glow texture: a single-channel radial gradient drawn on a
// canvas, used as the alpha map for the gem's sprite halo. Cached at
// module scope so a second gem build (manifest swap on rebuild) reuses
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

  // Gem size scales with the street's width. The layout reserves extra dead
  // space at the root street's origin end (see GEM_SIZING), so the origin
  // cap has no buildings overlapping it — the road's rounded cap IS the
  // plaza. RADIUS_AS_STREET_FRAC MUST match what layout.ts uses to reserve
  // that pad.
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
  // Material refs are stashed on gem.userData so the theme effect + the render
  // loop can mutate scale/opacity/color without rebuilding. Glow visibility
  // is driven by the GEM_GLOW.ENABLED flag.
  //
  // Skipped when _makeGlowTexture returns null (jsdom test env).
  const gem = new THREE.Group();
  const glowCfg = GEM.value;
  const glowTex = _makeGlowTexture();
  let innerGlowSprite: THREE.Sprite | null = null;
  let outerGlowSprite: THREE.Sprite | null = null;
  if (glowTex) {
    innerGlowSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
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
      })
    );
    innerGlowSprite.scale.set(
      radius * glowCfg.GLOW_INNER_SCALE,
      radius * glowCfg.GLOW_INNER_SCALE,
      1
    );
    innerGlowSprite.visible = glowCfg.GLOW_ENABLED;
    // Glow is purely visual — never absorbs hover / click. Sprites are
    // raycast-pickable by default, so override with a no-op.
    innerGlowSprite.raycast = () => {};

    outerGlowSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTex,
        color: new THREE.Color(edgeColor),
        transparent: true,
        opacity: glowCfg.GLOW_OUTER_OPACITY,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        // Depth test OFF on the OUTER halo only: this big atmospheric
        // sprite extends far enough that the island silhouette slices it
        // in a harsh line at low camera angles when depth-tested. It's
        // dim/diffuse enough that the canopy bleed-through (the reason
        // depth-test is ON for the inner sprite) is barely visible here.
        // The inner sprite keeps depthTest: true so the bright core still
        // gets occluded behind buildings/trees correctly.
        depthTest: false,
      })
    );
    outerGlowSprite.scale.set(
      radius * glowCfg.GLOW_OUTER_SCALE,
      radius * glowCfg.GLOW_OUTER_SCALE,
      1
    );
    outerGlowSprite.visible = glowCfg.GLOW_ENABLED;
    outerGlowSprite.raycast = () => {};

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
  // Glow sprite refs for theme updates on Save and per-frame color
  // cycling. Either may be null when the host can't build a gradient
  // texture (jsdom test env).
  gem.userData.innerGlowSprite = innerGlowSprite;
  gem.userData.outerGlowSprite = outerGlowSprite;

  group.add(gem);
  group.userData.gem = gem;
  return group;
}
