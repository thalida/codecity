import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('building.vert.glsl', () => {
  it('starts with a comment', () => {
    const src = readFileSync(
      resolve(__dirname, '../../scene/shaders/building.vert.glsl'),
      'utf-8'
    );
    expect(src.trimStart()).toMatch(/^\/\/ building\.vert\.glsl/);
  });

  it('declares the required instance attributes', () => {
    const src = readFileSync(
      resolve(__dirname, '../../scene/shaders/building.vert.glsl'),
      'utf-8'
    );
    expect(src).toMatch(/attribute vec2 iCols/);
    expect(src).toMatch(/attribute float iFloors/);
    expect(src).toMatch(/attribute float iOrient/);
    expect(src).toMatch(/attribute float iDoorWidth/);
    expect(src).toMatch(/attribute float iOpacity/);
  });

  it('declares all varyings the fragment shader expects', () => {
    const src = readFileSync(
      resolve(__dirname, '../../scene/shaders/building.vert.glsl'),
      'utf-8'
    );
    for (const v of ['vFace', 'vUv', 'vCols', 'vFloors', 'vOrient', 'vDoorWidth', 'vOpacity', 'vColor', 'vScale']) {
      expect(src).toContain(v);
    }
  });
});
