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

  it('declares uSkyColor / uHorizonColor / uHorizonHeight / uGroundColor for the sky fill', () => {
    expect(src).toContain('uSkyColor');
    expect(src).toContain('uHorizonColor');
    expect(src).toContain('uHorizonHeight');
    expect(src).toContain('uGroundColor');
  });

  it('mixes uHorizonColor into uSkyColor over the horizon band', () => {
    // A mix() call between the horizon and sky colors over the
    // smoothstep'd band confirms the horizon glow is wired in.
    expect(src).toMatch(/mix\(\s*uHorizonColor\s*,\s*uSkyColor/);
  });

  it('declares the star uniforms + the time uniform driving twinkle', () => {
    for (const u of [
      'uStarsEnabled', 'uStarDensity', 'uStarSize', 'uStarBrightness',
      'uTwinkleEnabled', 'uTwinkleSpeed', 'uTwinkleAmplitude',
      'uStarMinElevation',
      'uTime',
    ]) {
      expect(src).toContain(u);
    }
  });

  it('renders dir.y < 0 as the solid ground fill (early return)', () => {
    expect(src).toMatch(/if\s*\(\s*dir\.y\s*<\s*0/);
  });

  it('uses a hash to scatter stars (deterministic per direction)', () => {
    expect(src).toMatch(/sin\(\s*dot\([^)]*,\s*vec2\s*\(\s*12\.9898/);
  });

  it('drives twinkle through sin(uTime * ...)', () => {
    expect(src).toMatch(/sin\(\s*uTime\s*\*/);
  });

  it('renders stars as circular sub-cell dots (smoothstep on distance)', () => {
    // Star radius is captured as `r = max(uStarSize, 1e-4)` and then
    // fed to smoothstep against distToCenter.
    expect(src).toContain('float r = max(uStarSize');
    expect(src).toMatch(/smoothstep\s*\([^)]*distToCenter/);
  });

  it('writes a single gl_FragColor', () => {
    expect(src).toContain('gl_FragColor');
  });
});
