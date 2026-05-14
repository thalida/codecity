// scene/postFx.ts — Real bloom for the cyberpunk neon look.
//
// Wraps the EffectComposer + RenderPass + UnrealBloomPass + OutputPass
// pipeline so main.ts can swap `renderer.render(scene, camera)` for
// `postFx.render()` without knowing anything about post-processing
// internals. OutputPass at the tail handles tonemapping + linear → sRGB
// conversion that EffectComposer's offscreen render targets would
// otherwise skip.
//
// Tuning:
//   threshold — luma cutoff below which a pixel doesn't contribute to
//               bloom. Emissive windows (shadeColor + lightness boost)
//               push past this; ambient-lit walls stay below it, so
//               buildings themselves don't bloom — only the windows.
//   strength  — overall bloom intensity.
//   radius    — how far each bright pixel's glow spreads.

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

export interface PostFx {
  render(): void;
  setSize(width: number, height: number): void;
  dispose(): void;
}

const BLOOM_STRENGTH = 0.6;
const BLOOM_RADIUS = 0.45;
const BLOOM_THRESHOLD = 0.75;

export function createPostFx(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
): PostFx {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  const bloom = new UnrealBloomPass(
    new THREE.Vector2(1, 1), // resized via setSize() immediately after construction
    BLOOM_STRENGTH,
    BLOOM_RADIUS,
    BLOOM_THRESHOLD,
  );
  composer.addPass(bloom);

  // EffectComposer renders into linear-space float targets; the final
  // OutputPass tonemaps + converts back to sRGB so the canvas matches
  // what renderer.render(scene, camera) would have produced directly.
  composer.addPass(new OutputPass());

  return {
    render: () => composer.render(),
    setSize: (w, h) => {
      composer.setSize(w, h);
      bloom.setSize(w, h);
    },
    dispose: () => {
      bloom.dispose();
      composer.dispose();
    },
  };
}
