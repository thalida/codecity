import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { BuildingKind } from '@/city/components/buildings/buildingKind';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHADERS = resolve(__dirname, '../../../../src/city/components/buildings');

describe('building.vert.glsl', () => {
  const src = readFileSync(resolve(SHADERS, 'building.vert.glsl'), 'utf-8');
  it('declares all required instance attributes', () => {
    for (const a of ['iCols', 'iFloors', 'iDoor', 'iFade', 'iKind', 'iRefColor']) {
      expect(src).toMatch(new RegExp(`attribute \\w+ ${a}`));
    }
  });

  // WebGL2 guarantees only 16 vertex attributes, and this shader sits exactly
  // at the cap: 8 declared here plus position/normal/uv, instanceMatrix (4
  // slots) and instanceColor. A 9th declared attribute breaks on conforming
  // hardware, which no unit test can catch (vitest has no GPU).
  it('stays within the 16-attribute ceiling', () => {
    const declared = src.match(/^attribute /gm) ?? [];
    expect(declared.length).toBe(8);
  });
  it('declares all varyings the fragment expects', () => {
    for (const v of [
      'vFace',
      'vUv',
      'vCols',
      'vFloors',
      'vOrient',
      'vDoorWidth',
      'vOpacity',
      'vColor',
      'vScale',
      'vKind',
    ]) {
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
  it('branches on named face constants', () => {
    expect(src).toMatch(/vFace == FACE_ROOF/);
    expect(src).toMatch(/vFace == FACE_BOTTOM/);
    expect(src).toContain('const int FACE_ROOF = 2;');
  });
  it('declares hsl_glsl_inline include marker', () => {
    expect(src).toContain('#include <hsl_glsl_inline>');
  });
  it('crumbles the top off a ghost-ruin (KIND_RUIN branch discards)', () => {
    expect(src).toMatch(/vKind == KIND_RUIN/);
    expect(src).toMatch(/discard/);
  });

  it('renders data buildings windowless via the KIND_DATA branch', () => {
    expect(src).toMatch(/vKind == KIND_DATA/);
    // iKind is a flat int enum (exact equality), not a float threshold.
    expect(src).toContain('const int KIND_DATA');
  });

  it('renders empty files as a bare slab via the KIND_EMPTY branch', () => {
    expect(src).toMatch(/vKind == KIND_EMPTY/);
    expect(src).toContain('const int KIND_EMPTY = 4;');
  });

  it('mirrors every BuildingKind value as a KIND_* int const', () => {
    // The enum and the shader consts are hand-synced; drift silently renders
    // the wrong mode for a whole class of buildings.
    for (const [name, value] of Object.entries(BuildingKind)) {
      expect(src).toContain(`const int KIND_${name.toUpperCase()} = ${value};`);
    }
  });
});
