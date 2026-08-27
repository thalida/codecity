// hash.glsl exists because fract(sin(x) * 43758.5453) randomness breaks on
// mobile GPUs: Adreno/Mali return garbage or NaN for sin() past a few
// thousand, and one NaN pixel smears into rectangular blocks through the
// bloom blur. This pins that no city shader reintroduces a sin-based hash.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const CITY_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../city/src');

function glslFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...glslFiles(p));
    else if (p.endsWith('.glsl')) out.push(p);
  }
  return out;
}

describe('hash.glsl (mobile-safe randomness)', () => {
  it('no city shader uses the sin-based hash', () => {
    const offenders = glslFiles(CITY_DIR).filter((p) => {
      if (p.endsWith('utils/shaders/hash.glsl')) return false; // documents the pattern
      const src = readFileSync(p, 'utf-8');
      return /fract\s*\(\s*sin\s*\(/.test(src) || src.includes('43758');
    });
    expect(offenders).toEqual([]);
  });

  it('the chunk defines the four hashes shaders include', () => {
    const src = readFileSync(join(CITY_DIR, 'utils/shaders/hash.glsl'), 'utf-8');
    for (const sig of [
      'float hash11(float p)',
      'float hash21(vec2 p)',
      'float hash13(vec3 p3)',
      'vec3 hash33(vec3 p3)',
    ]) {
      expect(src).toContain(sig);
    }
  });
});
