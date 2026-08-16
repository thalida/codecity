// city/components/sky/index.ts — one inverted icosphere wrapping the scene:
// flat sky colour, hashed star field, sine twinkle. Persistent, never rebuilt
// (wallpaper does not depend on the manifest), and it owns its own settings
// effect, its per-frame work and its GPU teardown.
import * as THREE from 'three';

import { SCENE } from '@/state/settings/fields/scene';
import { CAMERA_FAR } from '@/city/constants/camera';
import { RENDER_ORDERS } from '@/city/types/renderOrders';
import { setColorFromHex } from '@/city/utils/color/setColorFromHex';

import type { FrameContext, SceneComponent, SceneContext } from '../../types';
import { onSettings } from '../../utils/onSettings';
import skyVertSrc from './sky.vert.glsl?raw';
import skyFragSrc from './sky.frag.glsl?raw';

// Multiplier on CAMERA_PERSPECTIVE.FAR: 0.95 keeps the sphere inside the far
// plane, so the depth pass cannot clip it before it draws.
const RADIUS_FAR_FRAC = 0.95;

// 3 → 642 vertices: never reads as faceted, and the shader does its work in
// the fragment stage anyway.
const ICOSAHEDRON_DETAIL = 3;

// Star radius as a fraction of its cell, with a smoothstep edge. Fixed, not
// user-tunable.
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

// `_ctx` is for createX(ctx) uniformity: the sky needs nothing at construction
// and reaches the camera through FrameContext in tick().
export function createSky(ctx: SceneContext): Sky {
  // Read at build time: FAR only changes on a fresh boot, so the radius has
  // nothing to track.
  const radius = CAMERA_FAR * RADIUS_FAR_FRAC;

  const geometry = new THREE.IcosahedronGeometry(radius, ICOSAHEDRON_DETAIL);

  const cfg = SCENE.value;

  const material = new THREE.ShaderMaterial({
    vertexShader: skyVertSrc,
    fragmentShader: skyFragSrc,
    side: THREE.BackSide,
    depthWrite: false,
    // renderOrder -1000 means nothing has written depth yet, so the test would
    // do no work. It also kept a zoom-flicker at the NDC z=1.0 boundary away.
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

      uAuroraEnabled: { value: cfg.AURORA_ENABLED ? 1.0 : 0.0 },
      uAuroraIntensity: { value: cfg.AURORA_INTENSITY },
    },
  });
  setColorFromHex(material.uniforms.uSkyColor.value as THREE.Color, cfg.SKY_COLOR);

  const group = new THREE.Mesh(geometry, material);
  group.renderOrder = RENDER_ORDERS.SKY;
  group.frustumCulled = false;
  group.userData.cyberpunkValley = 'sky';

  // Pushes SCENE into the uniforms with no rebuild. Runs once at construction
  // too, re-applying what the constructor already baked.
  const stopEffect = onSettings(SCENE, () => {
    const c = SCENE.value;
    setColorFromHex(material.uniforms.uSkyColor.value as THREE.Color, c.SKY_COLOR);
    material.uniforms.uStarsEnabled.value = c.STARS_ENABLED ? 1.0 : 0.0;
    material.uniforms.uStarDensity.value = c.STARS_DENSITY;
    material.uniforms.uAuroraEnabled.value = c.AURORA_ENABLED ? 1.0 : 0.0;
    material.uniforms.uAuroraIntensity.value = c.AURORA_INTENSITY;
    // The RenderPass background behind the sphere. Sky owns it, so applyManifest
    // does not have to.
    ctx.scene.background = new THREE.Color(c.SKY_COLOR);
  });

  // The camera-follow recentre MUST be the last mutation before render: done
  // mid-frame it raced matrix updates and drew an off-centre flickering disc.
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
