// city/utils/shaders/registerShaderChunks.ts — Register our project's GLSL
// chunks with THREE.ShaderChunk so #include <name> resolves natively.
//
// Import this module ONCE at scene init (before any ShaderMaterial is
// created). Idempotent — safe to import from multiple entry points.

import * as THREE from 'three';
import hslGlslSrc from './hsl.glsl?raw';
import fogGlslSrc from './fog.glsl?raw';
import hashGlslSrc from './hash.glsl?raw';

let _registered = false;

export function registerShaderChunks(): void {
  if (_registered) return;
  _registered = true;
  const chunks = THREE.ShaderChunk as unknown as Record<string, string>;
  chunks['hsl_glsl_inline'] = hslGlslSrc;
  chunks['fog_glsl_inline'] = fogGlslSrc;
  chunks['hash_glsl_inline'] = hashGlslSrc;
}
