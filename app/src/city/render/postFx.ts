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

// Bloom's mip chain is sized as a fraction of the DRAWING BUFFER, not of the
// CSS box. UnrealBloomPass halves whatever it is given before its first mip,
// so 0.5 here means mip 0 is a quarter of the drawing buffer on every display.
//
// Why it is pinned to the drawing buffer: EffectComposer.setSize already
// scales every pass by the renderer's pixel ratio, so passing CSS pixels made
// bloom's cost depend on DPR. A DPR-2 display got a chain at a quarter of its
// scene resolution; a DPR-1 display got one at full scene resolution, i.e. 4x
// the bloom per scene pixel — on the low-DPR integrated-GPU machines least
// able to pay it. 0.5 reproduces the DPR-2 sizing exactly and gives DPR-1 the
// same discount.
//
// The blur kernel radii are fixed in UnrealBloomPass, so lowering this widens
// the glow as well as cheapening it.
const BLOOM_RESOLUTION_SCALE = 0.5;

export interface PostFx {
  render(): void;
  setSize(width: number, height: number): void;
  dispose(): void;
}

export function createPostFx(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera
): PostFx {
  const bloomCfg = BLOOM.value;
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
      // composer.setSize takes CSS pixels and scales them by the pixel ratio
      // internally — including for the bloom pass, whose size we then override
      // with our own fraction of the resulting drawing buffer. Order matters:
      // this must come second or the composer's DPR-scaled value wins.
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
