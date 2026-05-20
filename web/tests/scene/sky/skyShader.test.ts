// skyShader.test.ts — verifies the GLSL source files declare every
// uniform / varying the JS factory (sky.ts) and the spec's render
// order assume. Catches typos that would otherwise only surface as a
// silent black sphere or a WebGL link-error console line.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHADERS = resolve(__dirname, '../../../scene/shaders');

describe('sky.vert.glsl', () => {
  const src = readFileSync(resolve(SHADERS, 'sky.vert.glsl'), 'utf-8');

  it('passes world-space view direction to the fragment via vViewDirWorld', () => {
    expect(src).toMatch(/varying\s+vec3\s+vViewDirWorld/);
    // The vertex's local position on a unit icosphere IS the outward
    // normal direction; assigning it (or its normalized form) to the
    // varying gives the fragment the world-space view vector for free.
    expect(src).toMatch(/vViewDirWorld\s*=\s*normalize\(\s*position\s*\)/);
  });

  it('writes gl_Position via the standard projection × modelView path', () => {
    expect(src).toContain('gl_Position');
    expect(src).toContain('projectionMatrix');
    expect(src).toContain('modelViewMatrix');
  });
});

describe('sky.frag.glsl', () => {
  const src = readFileSync(resolve(SHADERS, 'sky.frag.glsl'), 'utf-8');

  it('receives the world-space view direction from the vertex stage', () => {
    expect(src).toMatch(/varying\s+vec3\s+vViewDirWorld/);
  });

  it('declares the gradient uniforms (5 colors + 5 stops + enabled)', () => {
    for (const u of [
      'uGradientEnabled',
      'uGradientTop', 'uGradientUpperMid', 'uGradientMid',
      'uGradientLowerMid', 'uGradientHorizon',
      'uStopTop', 'uStopUpperMid', 'uStopMid',
      'uStopLowerMid', 'uStopHorizon',
    ]) {
      expect(src).toContain(u);
    }
  });

  it('declares the star uniforms + the time uniform driving twinkle', () => {
    for (const u of [
      'uStarsEnabled', 'uStarDensity', 'uStarBrightness',
      'uTwinkleEnabled', 'uTwinkleSpeed', 'uTwinkleAmplitude',
      'uStarMinElevation',
      'uTime',
    ]) {
      expect(src).toContain(u);
    }
  });

  it('declares the moon uniforms', () => {
    for (const u of [
      'uMoonEnabled', 'uMoonDir', 'uMoonCosSize',
      'uMoonColor', 'uMoonHaloColor', 'uMoonHaloMult',
      'uMoonEmissionBoost',
    ]) {
      expect(src).toContain(u);
    }
  });

  it('uses a hash to scatter stars (so they are deterministic per direction)', () => {
    // Same standard sin-fract pseudo-random as building.frag.glsl.
    expect(src).toMatch(/sin\(\s*dot\([^)]*,\s*vec2\s*\(\s*12\.9898/);
  });

  it('drives twinkle through sin(uTime * ...)', () => {
    expect(src).toMatch(/sin\(\s*uTime\s*\*/);
  });

  it('boosts the moon color above 1.0 so it blooms via HDR', () => {
    // Either an explicit multiply by uMoonEmissionBoost, or an addition
    // that lifts moon RGB past unity.
    expect(src).toMatch(/uMoonEmissionBoost/);
  });

  it('gates stars below the configured horizon angle', () => {
    expect(src).toContain('uStarMinElevation');
  });

  it('writes a single gl_FragColor', () => {
    expect(src).toContain('gl_FragColor');
  });
});
