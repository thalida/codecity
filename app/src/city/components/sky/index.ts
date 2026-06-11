// city/components/sky/index.ts — Cyberpunk Valley procedural sky COMPONENT
// (public door).
//
// Self-contained scene component: builds one global inverted-icosphere
// mesh that wraps the entire scene. The fragment shader writes a flat
// uSkyColor across the sphere (the world floor mesh handles real
// ground), plus a hashed star field with sine twinkle. The component
// owns its settings-reactivity (an effect reading SCENE) and its
// per-frame work (tick: star twinkle + camera follow), and frees its
// own GPU resources + stops its effect in dispose(). Persistent — built
// once, never rebuilt (the sky is wallpaper, independent of the manifest).
//
// Lifecycle (matches the other createX(ctx) components under app/city/):
//
//   const sky = createSky(ctx);
//   scene.add(sky.group);            // once, at world boot
//   sky.tick(dt, frameCtx);          // each frame, LAST before render
//   sky.dispose();                   // on world teardown
//
// The settings effect replaces the old refresh() / applyTheme() path:
// it reads SCENE (SKY_COLOR, STARS_ENABLED, STARS_DENSITY) and pushes
// fresh values into the material uniforms with no rebuild, re-running
// on every SCENE Save. It runs once at construction (idempotently
// re-applying the same values the constructor baked).
//
// Construction-time bridge (Strategy A, same as the gem): the sky is
// built inside world.ts BEFORE the picker/camera/renderer exist. The
// component accepts the SceneContext for composer uniformity but uses
// nothing from it at construction; tick() reaches the camera via the
// per-frame FrameContext.
//
// Render order: RENDER_ORDERS.SKY (-1000), depthWrite:false,
// side:BackSide. The sphere never occludes other geometry and always
// draws first; the existing post-FX HDR pipeline (app/city/postFx.ts)
// then composites everything on top.

import * as THREE from 'three';

import { SCENE } from '@/state/stores/settings/scene';
import { CAMERA_FAR } from '@/constants/camera';
import { RENDER_ORDERS } from '@/city/constants/renderOrders';
import { setColorFromHex } from '@/city/utils/color/setColorFromHex';

import type { FrameContext, SceneComponent, SceneContext } from '../../types';
import { onSettings } from '../../utils/onSettings';
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

// Hardcoded star appearance values (removed from user-tunable controls).
// Star spot radius as a fraction of the cell — 0.15 = each star
// occupies a circle ~15% of the cell's width, with a smoothstep
// antialiased edge.
const STAR_SIZE = 0.15;
// Per-star intensity added on top of the sky color.
const STAR_BRIGHTNESS = 1.2;
// Twinkle: 1.0 = on (float uniform, not bool), speed multiplier on
// uTime, and amplitude (0 = no flicker, 1 = fully on/off).
const TWINKLE_ENABLED = 1.0;
const TWINKLE_SPEED = 0.5;
const TWINKLE_AMPLITUDE = 1.0;

export interface Sky extends SceneComponent {
  /** The sky icosphere mesh, exposed as the component `group`. */
  group: THREE.Mesh;
}

// `_ctx` is accepted for createX(ctx) composer uniformity; the sky uses
// nothing from it at construction (it reaches the camera via FrameContext
// in tick()). The `_`-prefix matches the eslint argsIgnorePattern.
export function createSky(_ctx: SceneContext): Sky {
  // Radius is read from CAMERA_PERSPECTIVE.FAR at build time. The
  // camera FAR plane is itself a fixed user config (default 20000)
  // and changes only require a fresh boot, so this radius does not
  // need to track FAR live.
  const radius = CAMERA_FAR * RADIUS_FAR_FRAC;

  const geometry = new THREE.IcosahedronGeometry(radius, ICOSAHEDRON_DETAIL);

  const cfg = SCENE.value;

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

      uStarsEnabled: { value: cfg.STARS_ENABLED ? 1.0 : 0.0 },
      uStarDensity: { value: cfg.STARS_DENSITY },
      uStarSize: { value: STAR_SIZE },
      uStarBrightness: { value: STAR_BRIGHTNESS },
      uTwinkleEnabled: { value: TWINKLE_ENABLED },
      uTwinkleSpeed: { value: TWINKLE_SPEED },
      uTwinkleAmplitude: { value: TWINKLE_AMPLITUDE },
    },
  });
  setColorFromHex(material.uniforms.uSkyColor.value as THREE.Color, cfg.SKY_COLOR);

  const group = new THREE.Mesh(geometry, material);
  group.renderOrder = RENDER_ORDERS.SKY;
  group.frustumCulled = false;
  group.userData.cyberpunkValley = 'sky';

  // Settings effect — reacts to SCENE changes (Save). Replaces the old
  // sky.refresh() call in renderLoop.applyTheme(). Reads only SKY_COLOR /
  // STARS_ENABLED / STARS_DENSITY and pushes them into the uniforms (same
  // writes as the old refresh(), verbatim). Runs once at construction,
  // re-applying the same values the constructor baked (idempotent).
  const stopEffect = onSettings(SCENE, () => {
    const c = SCENE.value;
    setColorFromHex(material.uniforms.uSkyColor.value as THREE.Color, c.SKY_COLOR);
    material.uniforms.uStarsEnabled.value = c.STARS_ENABLED ? 1.0 : 0.0;
    material.uniforms.uStarDensity.value = c.STARS_DENSITY;
  });

  // Per-frame work, run LAST before postFx.render():
  //   1. star twinkle — advance uTime by dt.
  //   2. camera follow — recenter the sphere on the camera so the camera
  //      never falls outside its own sky. This MUST be the last mutation
  //      before render (doing it mid-frame raced with scene matrix updates
  //      and, during fast orbit, rendered the sphere at the previous
  //      frame's position — an off-center disc with black-flicker edges).
  function tick(dt: number, frame: FrameContext): void {
    material.uniforms.uTime.value += dt;
    group.position.copy(frame.camera.position);
    group.updateMatrixWorld(true);
  }

  function dispose(): void {
    if (group.parent) group.parent.remove(group);
    geometry.dispose();
    material.dispose();
    stopEffect();
  }

  return { group, tick, dispose };
}
