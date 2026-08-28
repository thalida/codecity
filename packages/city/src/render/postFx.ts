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
import type { CitySettingsStore } from '@/city/settings/store';

// Fraction of the DRAWING BUFFER, not the CSS box: composer.setSize already
// applies the pixel ratio, so CSS sizing cost DPR-1 displays 4x per scene pixel.
const BLOOM_RESOLUTION_SCALE = 0.5;

export interface PostFx {
  render(): void;
  setSize(width: number, height: number): void;
  dispose(): void;
}

export function createPostFx(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  settings: CitySettingsStore
): PostFx {
  const bloomCfg = settings.BLOOM;
  // Reused by setSize so the per-resize drawing-buffer read costs no alloc.
  const _drawingBuffer = new THREE.Vector2();
  // ACES squashes >1.0 back into display range: walls (already [0,1]) are
  // untouched, and only the emissive windows read as blown out.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  // HalfFloat preserves the shader's >1.0 emission; an LDR target would clip
  // it and erase the per-pixel bloom gradient.
  const hdrTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
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
  const stopBloom = settings.on('BLOOM', () => {
    const cfg = settings.BLOOM;
    bloom.enabled = cfg.ENABLED;
    bloom.strength = cfg.STRENGTH;
    bloom.radius = cfg.RADIUS;
    bloom.threshold = cfg.THRESHOLD;
  });

  return {
    render: () => composer.render(),
    setSize: (w, h) => {
      // Order matters: composer.setSize sizes every pass, bloom included, so
      // the deliberate override below has to come second or it is overwritten.
      composer.setSize(w, h);
      renderer.getDrawingBufferSize(_drawingBuffer);
      bloom.setSize(
        Math.max(1, Math.round(_drawingBuffer.x * BLOOM_RESOLUTION_SCALE)),
        Math.max(1, Math.round(_drawingBuffer.y * BLOOM_RESOLUTION_SCALE))
      );
    },
    dispose: () => {
      stopBloom();
      hdrTarget.dispose();
      bloom.dispose();
      composer.dispose();
    },
  };
}
