// scene/sky/sky.ts — Cyberpunk Valley procedural sky factory.
//
// Builds one global inverted-icosphere mesh that wraps the entire
// scene. The fragment shader writes a flat uSkyColor across the
// entire sphere (the world floor mesh handles real ground), plus a
// hashed star field across the full sphere with sine twinkle. Every
// dial lives in two nanostore configs (SKY, SKY_STARS) and is
// hot-reloadable via the existing applyTheme() path — sky.refresh()
// pulls fresh values into uniforms with no rebuild.
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
import { SKY, SKY_STARS } from '@/config/components/sky.js';
import { CAMERA_PERSPECTIVE } from '@/config/system/cameraRig.js';
import { RENDER_ORDERS } from '@/constants';

import skyVertSrc from './sky.vert.glsl?raw';
import skyFragSrc from './sky.frag.glsl?raw';

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

  const sky = SKY.get();
  const stars = SKY_STARS.get();

  const material = new THREE.ShaderMaterial({
    vertexShader: skyVertSrc,
    fragmentShader: skyFragSrc,
    side: THREE.BackSide,
    depthWrite: false,
    // depthTest is OFF because renderOrder = -1000 guarantees the sky
    // draws BEFORE anything writes the depth buffer, so the depth test
    // isn't doing useful work for the sky. (It also avoids a defunct
    // zoom-flicker that the prior depth-trick variant introduced at
    // the NDC z=1.0 boundary — the trick is gone now, but disabling
    // depthTest is still the cleaner default for a guaranteed-first
    // background draw.)
    depthTest: false,
    uniforms: {
      uTime: { value: 0 },

      uSkyColor: { value: new THREE.Color() },

      uStarsEnabled: { value: stars.ENABLED ? 1.0 : 0.0 },
      uStarDensity: { value: stars.DENSITY },
      uStarSize: { value: stars.SIZE },
      uStarBrightness: { value: stars.BRIGHTNESS },
      uTwinkleEnabled: { value: stars.TWINKLE_ENABLED ? 1.0 : 0.0 },
      uTwinkleSpeed: { value: stars.TWINKLE_SPEED },
      uTwinkleAmplitude: { value: stars.TWINKLE_AMPLITUDE },
    },
  });
  setColorFromHex(material.uniforms.uSkyColor.value as THREE.Color, sky.COLOR);

  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = RENDER_ORDERS.SKY;
  mesh.frustumCulled = false;
  mesh.userData.cyberpunkValley = 'sky';
  mesh.visible = sky.ENABLED;

  function refresh(): void {
    const k = SKY.get();
    const s = SKY_STARS.get();

    setColorFromHex(material.uniforms.uSkyColor.value as THREE.Color, k.COLOR);

    material.uniforms.uStarsEnabled.value = s.ENABLED ? 1.0 : 0.0;
    material.uniforms.uStarDensity.value = s.DENSITY;
    material.uniforms.uStarSize.value = s.SIZE;
    material.uniforms.uStarBrightness.value = s.BRIGHTNESS;
    material.uniforms.uTwinkleEnabled.value = s.TWINKLE_ENABLED ? 1.0 : 0.0;
    material.uniforms.uTwinkleSpeed.value = s.TWINKLE_SPEED;
    material.uniforms.uTwinkleAmplitude.value = s.TWINKLE_AMPLITUDE;

    mesh.visible = k.ENABLED;
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
