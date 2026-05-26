// scene/shaders/registerShaderChunks.ts — Register our project's GLSL
// chunks with THREE.ShaderChunk so #include <name> resolves natively.
//
// Import this module ONCE at scene init (before any ShaderMaterial is
// created). Idempotent — safe to import from multiple entry points.

import * as THREE from 'three';
import hslGlslSrc from './hsl.glsl?raw';
import { FOG_UNIFORMS_GLSL, FOG_APPLY_GLSL } from '@/scene/components/lighting/fogChunk.js';

let _registered = false;

export function registerShaderChunks(): void {
  if (_registered) return;
  _registered = true;
  const chunks = THREE.ShaderChunk as unknown as Record<string, string>;
  chunks['hsl_glsl_inline'] = hslGlslSrc;
  chunks['fog_uniforms_glsl_inline'] = FOG_UNIFORMS_GLSL;
  chunks['fog_apply_glsl_inline'] = FOG_APPLY_GLSL;
}
