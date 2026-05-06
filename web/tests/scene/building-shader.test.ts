import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHADERS = resolve(__dirname, '../../scene/shaders');

describe('building.vert.glsl', () => {
  const src = readFileSync(resolve(SHADERS, 'building.vert.glsl'), 'utf-8');
  it('declares all required instance attributes', () => {
    for (const a of ['iCols', 'iFloors', 'iOrient', 'iDoorWidth', 'iOpacity']) {
      expect(src).toMatch(new RegExp(`attribute \\w+ ${a}`));
    }
  });
  it('declares all varyings the fragment expects', () => {
    for (const v of ['vFace', 'vUv', 'vCols', 'vFloors', 'vOrient', 'vDoorWidth', 'vOpacity', 'vColor', 'vScale']) {
      expect(src).toContain(v);
    }
  });
});

describe('building.frag.glsl', () => {
  const src = readFileSync(resolve(SHADERS, 'building.frag.glsl'), 'utf-8');
  it('uses analytical AA via fwidth/smoothstep', () => {
    expect(src).toContain('fwidth(');
    expect(src).toContain('smoothstep(');
  });
  it('branches on face index', () => {
    expect(src).toMatch(/vFace == 2/); // roof
    expect(src).toMatch(/vFace == 3/); // bottom
  });
  it('declares hsl_glsl_inline include marker', () => {
    expect(src).toContain('#include <hsl_glsl_inline>');
  });
});
