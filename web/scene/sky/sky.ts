// scene/sky/sky.ts — Cyberpunk Valley procedural sky factory.
//
// Builds one global inverted-icosphere mesh that wraps the entire
// scene. The fragment shader writes a vertical color gradient,
// hashed-star field with sine twinkle, and an HDR-emissive moon
// disk + halo. Every dial lives in three nanostore configs
// (SKY_GRADIENT, SKY_STARS, SKY_MOON) and is hot-reloadable via
// the existing applyTheme() path — sky.refresh() pulls fresh
// values into uniforms with no rebuild.
//
// Lifecycle (matches the other createX factories under web/scene/):
//
//   const sky = createSky();
//   scene.add(sky.mesh);          // once, at cityScene boot
//   sky.tick(elapsedSeconds);     // each frame, before render
//   sky.refresh();                // on every applyTheme() hot-reload
//   sky.dispose();                // on cityScene teardown
//
// Render order: RENDER_ORDERS.SKY (-1000), depthWrite:false,
// side:BackSide. The sphere never occludes other geometry and always
// draws first; the existing post-FX HDR pipeline (web/scene/postFx.ts)
// then composites everything on top.

import * as THREE from 'three';
import { SKY_GRADIENT, SKY_STARS, SKY_MOON } from '@/config/sky.js';
import { CAMERA_PERSPECTIVE } from '@/config/view.js';
import { RENDER_ORDERS } from '@/constants';

import skyVertSrc from '../shaders/sky.vert.glsl?raw';
import skyFragSrc from '../shaders/sky.frag.glsl?raw';

// Multiplier on CAMERA_PERSPECTIVE.FAR for the sky sphere's radius.
// 0.95 keeps the sphere inside the frustum's far plane so it never
// gets clipped by the depth pass before being drawn. The spec calls
// out this value explicitly.
const RADIUS_FAR_FRAC = 0.95;

// Icosphere detail. 3 → 642 vertices / 1280 faces — smooth enough that
// the silhouette never reads as faceted at any reasonable FOV, cheap
// to rasterize because the shader does all the work in the fragment
// stage anyway.
const ICOSAHEDRON_DETAIL = 3;

export interface Sky {
  mesh: THREE.Mesh;
  /** Pull fresh SKY_* config values into the material uniforms. */
  refresh(): void;
  /** Advance uTime by `dtSeconds` (drives the star twinkle). */
  tick(dtSeconds: number): void;
  /** Release geometry + material GPU resources. */
  dispose(): void;
}

/**
 * Convert (azimuth, elevation) in degrees into a unit world-space
 * direction. Same convention as LIGHTING / scene/instanced/buildings.ts:
 *   - azimuth 0 = +Z (south); increases clockwise (azimuth 90 = +X / east).
 *   - elevation 0 = horizon; elevation 90 = +Y / overhead.
 */
function sphericalToDir(out: THREE.Vector3, azDeg: number, elDeg: number): void {
  const az = (azDeg * Math.PI) / 180;
  const el = (elDeg * Math.PI) / 180;
  const cosEl = Math.cos(el);
  out.set(Math.sin(az) * cosEl, Math.sin(el), Math.cos(az) * cosEl).normalize();
}

/**
 * setStyle(..., LinearSRGBColorSpace) skips Three's automatic
 * sRGB→linear conversion. The fragment shader runs in display sRGB
 * (same as building.frag.glsl — ShaderMaterial gets no automatic
 * linearToOutputTexel pass), so we pass the hex bytes through
 * unchanged.
 */
function setColorFromHex(target: THREE.Color, hex: string): void {
  target.setStyle(hex, THREE.LinearSRGBColorSpace);
}

export function createSky(): Sky {
  // Radius is read from CAMERA_PERSPECTIVE.FAR at build time. The
  // camera FAR plane is itself a fixed user config (default 20000)
  // and changes only require a fresh boot, so this radius does not
  // need to track FAR live.
  const radius = CAMERA_PERSPECTIVE.get().FAR * RADIUS_FAR_FRAC;

  const geometry = new THREE.IcosahedronGeometry(radius, ICOSAHEDRON_DETAIL);

  const gradient = SKY_GRADIENT.get();
  const stars = SKY_STARS.get();
  const moon = SKY_MOON.get();

  const uMoonDir = new THREE.Vector3();
  sphericalToDir(uMoonDir, moon.AZIMUTH_DEG, moon.ELEVATION_DEG);

  const material = new THREE.ShaderMaterial({
    vertexShader: skyVertSrc,
    fragmentShader: skyFragSrc,
    side: THREE.BackSide,
    depthWrite: false,
    // depthTest stays on (default true) so the sphere doesn't paint
    // over closer geometry on the rare frame where renderOrder
    // sorting hiccups; with depthWrite:false and a renderOrder of
    // -1000 the sphere is reliably the first thing drawn.
    uniforms: {
      uTime: { value: 0 },

      uGradientEnabled: { value: gradient.ENABLED ? 1.0 : 0.0 },
      uGradientTop: { value: new THREE.Color() },
      uGradientUpperMid: { value: new THREE.Color() },
      uGradientMid: { value: new THREE.Color() },
      uGradientLowerMid: { value: new THREE.Color() },
      uGradientHorizon: { value: new THREE.Color() },
      uStopTop: { value: gradient.STOP_TOP },
      uStopUpperMid: { value: gradient.STOP_UPPER_MID },
      uStopMid: { value: gradient.STOP_MID },
      uStopLowerMid: { value: gradient.STOP_LOWER_MID },
      uStopHorizon: { value: gradient.STOP_HORIZON },

      uStarsEnabled: { value: stars.ENABLED ? 1.0 : 0.0 },
      uStarDensity: { value: stars.DENSITY },
      uStarBrightness: { value: stars.BRIGHTNESS },
      uTwinkleEnabled: { value: stars.TWINKLE_ENABLED ? 1.0 : 0.0 },
      uTwinkleSpeed: { value: stars.TWINKLE_SPEED },
      uTwinkleAmplitude: { value: stars.TWINKLE_AMPLITUDE },
      uStarMinElevation: {
        value: Math.sin((stars.MIN_ELEVATION_DEG * Math.PI) / 180),
      },

      uMoonEnabled: { value: moon.ENABLED ? 1.0 : 0.0 },
      uMoonDir: { value: uMoonDir },
      uMoonCosSize: {
        value: Math.cos((moon.SIZE_DEG * 0.5 * Math.PI) / 180),
      },
      uMoonColor: { value: new THREE.Color() },
      uMoonHaloColor: { value: new THREE.Color() },
      uMoonHaloMult: { value: moon.HALO_SIZE_MULT },
      uMoonEmissionBoost: { value: moon.EMISSION_BOOST },
    },
  });
  setColorFromHex(material.uniforms.uGradientTop.value as THREE.Color, gradient.TOP);
  setColorFromHex(material.uniforms.uGradientUpperMid.value as THREE.Color, gradient.UPPER_MID);
  setColorFromHex(material.uniforms.uGradientMid.value as THREE.Color, gradient.MID);
  setColorFromHex(material.uniforms.uGradientLowerMid.value as THREE.Color, gradient.LOWER_MID);
  setColorFromHex(material.uniforms.uGradientHorizon.value as THREE.Color, gradient.HORIZON);
  setColorFromHex(material.uniforms.uMoonColor.value as THREE.Color, moon.COLOR);
  setColorFromHex(material.uniforms.uMoonHaloColor.value as THREE.Color, moon.HALO_COLOR);

  const mesh = new THREE.Mesh(geometry, material);
  // Renders before everything else — see web/constants/render.ts.
  mesh.renderOrder = RENDER_ORDERS.SKY;
  // Sky frustum-culling would only ever yield true (the sphere covers
  // the whole view from inside), so the per-frame bounding-sphere
  // check is wasted work.
  mesh.frustumCulled = false;
  // The sphere is not moveable / interactable. Marked so picker / hit
  // tests can skip it without a structural check.
  mesh.userData.cyberpunkValley = 'sky';
  // Initial visibility tracks the master toggle. refresh() keeps
  // this in sync.
  mesh.visible = gradient.ENABLED;

  function refresh(): void {
    const g = SKY_GRADIENT.get();
    const s = SKY_STARS.get();
    const m = SKY_MOON.get();

    material.uniforms.uGradientEnabled.value = g.ENABLED ? 1.0 : 0.0;
    setColorFromHex(material.uniforms.uGradientTop.value as THREE.Color, g.TOP);
    setColorFromHex(material.uniforms.uGradientUpperMid.value as THREE.Color, g.UPPER_MID);
    setColorFromHex(material.uniforms.uGradientMid.value as THREE.Color, g.MID);
    setColorFromHex(material.uniforms.uGradientLowerMid.value as THREE.Color, g.LOWER_MID);
    setColorFromHex(material.uniforms.uGradientHorizon.value as THREE.Color, g.HORIZON);
    material.uniforms.uStopTop.value = g.STOP_TOP;
    material.uniforms.uStopUpperMid.value = g.STOP_UPPER_MID;
    material.uniforms.uStopMid.value = g.STOP_MID;
    material.uniforms.uStopLowerMid.value = g.STOP_LOWER_MID;
    material.uniforms.uStopHorizon.value = g.STOP_HORIZON;

    material.uniforms.uStarsEnabled.value = s.ENABLED ? 1.0 : 0.0;
    material.uniforms.uStarDensity.value = s.DENSITY;
    material.uniforms.uStarBrightness.value = s.BRIGHTNESS;
    material.uniforms.uTwinkleEnabled.value = s.TWINKLE_ENABLED ? 1.0 : 0.0;
    material.uniforms.uTwinkleSpeed.value = s.TWINKLE_SPEED;
    material.uniforms.uTwinkleAmplitude.value = s.TWINKLE_AMPLITUDE;
    material.uniforms.uStarMinElevation.value = Math.sin(
      (s.MIN_ELEVATION_DEG * Math.PI) / 180,
    );

    material.uniforms.uMoonEnabled.value = m.ENABLED ? 1.0 : 0.0;
    sphericalToDir(material.uniforms.uMoonDir.value as THREE.Vector3, m.AZIMUTH_DEG, m.ELEVATION_DEG);
    material.uniforms.uMoonCosSize.value = Math.cos((m.SIZE_DEG * 0.5 * Math.PI) / 180);
    setColorFromHex(material.uniforms.uMoonColor.value as THREE.Color, m.COLOR);
    setColorFromHex(material.uniforms.uMoonHaloColor.value as THREE.Color, m.HALO_COLOR);
    material.uniforms.uMoonHaloMult.value = m.HALO_SIZE_MULT;
    material.uniforms.uMoonEmissionBoost.value = m.EMISSION_BOOST;

    mesh.visible = g.ENABLED;
  }

  function tick(dtSeconds: number): void {
    material.uniforms.uTime.value += dtSeconds;
  }

  function dispose(): void {
    if (mesh.parent) mesh.parent.remove(mesh);
    geometry.dispose();
    material.dispose();
  }

  return { mesh, refresh, tick, dispose };
}
