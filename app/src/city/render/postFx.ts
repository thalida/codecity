// city/render/postFx.ts — HDR bloom pipeline for cyberpunk neon glow.
//
// Why HDR (HalfFloatType render targets):
// The building fragment shader writes a per-pixel emission multiplier
// for lit windows scaled by modifiedAge recencyCurve (newer = brighter). With LDR
// (UnsignedByteType, [0,1]) all values clamp to 1.0 and every lit
// window — old or new — caps at the same brightness, so the bloom
// threshold becomes a knife-edge: either nothing blooms or walls
// bloom. With HDR, newer-building windows push above 1.0 in
// extended range; bloom threshold at 1.0 then naturally varies bloom
// strength per pixel by how far that pixel exceeds 1.0. ACES
// tonemapping in OutputPass compresses the >1.0 range back to
// display [0,1] so the canvas stays unclipped.
//
// Tuning knobs:
//   threshold — luma cutoff in the HDR buffer. ≥1.0 means "only HDR
//               pixels bloom, regular walls are immune."
//   strength  — overall bloom intensity.
//   radius    — how far each bright pixel's glow spreads.

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { BLOOM } from '@/state/stores/settings/effects';

export interface PostFx {
  render(): void;
  setSize(width: number, height: number): void;
  refresh(): void;
  dispose(): void;
}

export function createPostFx(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera
): PostFx {
  const bloomCfg = BLOOM.value;
  // ACES tonemapping compresses HDR (>1.0) values back into display
  // [0,1] for the canvas. The wall colors written by the shader stay
  // in [0,1] so they're mostly unchanged; only the emissive windows
  // that exceed 1.0 get squashed back — exactly the pixels we want
  // to look "blown out and glowing."
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  // HalfFloat render targets preserve >1.0 emission values from the
  // shader; LDR targets would clip them to 1.0 and erase the
  // per-pixel bloom intensity gradient.
  const hdrTarget = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
  });
  const composer = new EffectComposer(renderer, hdrTarget);
  composer.addPass(new RenderPass(scene, camera));

  const bloom = new UnrealBloomPass(
    new THREE.Vector2(1, 1), // resized via setSize() immediately after construction
    bloomCfg.STRENGTH,
    bloomCfg.RADIUS,
    bloomCfg.THRESHOLD
  );
  composer.addPass(bloom);

  // OutputPass picks up renderer.toneMapping (set above) and applies
  // the linear → sRGB conversion that the offscreen HDR targets skip,
  // so the final canvas pixels are correctly encoded.
  composer.addPass(new OutputPass());

  return {
    render: () => composer.render(),
    setSize: (w, h) => {
      composer.setSize(w, h);
      bloom.setSize(w, h);
    },
    // Pull fresh BLOOM config values into the bloom pass. Called from
    // applyTheme() on Save so the in-UI knobs take effect
    // without rebuilding the renderer. When ENABLED is off, the pass
    // is bypassed entirely (EffectComposer skips disabled passes) so
    // the render path approximates the pre-HDR "flat" look — paired
    // with refreshBuildingMaterial clamping uWindowEmissionBoost to 0
    // so no shader output reaches HDR space.
    refresh: () => {
      const cfg = BLOOM.value;
      bloom.enabled = cfg.ENABLED;
      bloom.strength = cfg.STRENGTH;
      bloom.radius = cfg.RADIUS;
      bloom.threshold = cfg.THRESHOLD;
    },
    dispose: () => {
      hdrTarget.dispose();
      bloom.dispose();
      composer.dispose();
    },
  };
}
