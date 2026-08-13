// city/render/postFx.ts — HDR bloom pipeline. HalfFloat targets are the
// point: LDR would clamp every lit window to 1.0, making the bloom threshold
// a knife-edge (nothing blooms, or walls do). Above 1.0, how far a pixel
// exceeds the threshold varies its glow; ACES compresses it back for display.

import * as THREE from 'three';
import { effect } from '@preact/signals';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { BLOOM } from '@/state/stores/settings/effects';

export interface PostFx {
  render(): void;
  setSize(width: number, height: number): void;
  dispose(): void;
}

/** ?fx=off — render straight to the canvas (no composer/targets/bloom), to
 *  isolate driver corruption in the pipeline vs base scene rendering. */
export function createDirectFx(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera
): PostFx {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  return {
    render: () => renderer.render(scene, camera),
    setSize: () => {},
    dispose: () => {},
  };
}

export function createPostFx(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  opts: { ldr?: boolean } = {}
): PostFx {
  const bloomCfg = BLOOM.value;
  // ACES squashes >1.0 back into display range: walls (already [0,1]) are
  // untouched, and only the emissive windows read as blown out.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  // HalfFloat preserves the shader's >1.0 emission (LDR would clip it and
  // erase the bloom gradient); ?fx=ldr forces the clip for driver tests.
  const hdrTarget = new THREE.WebGLRenderTarget(1, 1, {
    type: opts.ldr ? THREE.UnsignedByteType : THREE.HalfFloatType,
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

  // OutputPass applies the linear → sRGB conversion the offscreen HDR
  // targets skip, so canvas pixels end up correctly encoded.
  composer.addPass(new OutputPass());

  // BLOOM Save → live knobs, no renderer rebuild. ENABLED off bypasses the
  // pass entirely, pairing with the shader's clamped emission for a flat look.
  const stopBloom = effect(() => {
    const cfg = BLOOM.value;
    bloom.enabled = cfg.ENABLED;
    bloom.strength = cfg.STRENGTH;
    bloom.radius = cfg.RADIUS;
    bloom.threshold = cfg.THRESHOLD;
  });

  return {
    render: () => composer.render(),
    setSize: (w, h) => {
      composer.setSize(w, h);
      bloom.setSize(w, h);
    },
    dispose: () => {
      stopBloom();
      hdrTarget.dispose();
      bloom.dispose();
      composer.dispose();
    },
  };
}
