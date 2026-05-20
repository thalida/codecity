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
