// GEM_SHAPES is the single source for the gem's polyhedra: the SIDES options
// derive from the same key set so the two cannot drift, each builder produces
// the expected geometry, and an unknown value falls back to the octahedron.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';

import { GEM_SHAPES, buildGemGeometry } from '@/city/components/gem/shapes';
import { GEM_SIDES, GEM_SIDES_DEFAULT, GEM_SIDES_NAMES } from '@codecity/city';
import { GEM } from '@/state/settings/fields/gem';
import { getFieldDef } from '@/state/settings/schema';

describe('GEM_SHAPES table', () => {
  it('covers exactly the canonical GEM_SIDES key set', () => {
    expect(Object.keys(GEM_SHAPES)).toEqual(GEM_SIDES);
    expect(Object.keys(GEM_SIDES_NAMES)).toEqual(GEM_SIDES);
    expect(GEM_SIDES).toContain(GEM_SIDES_DEFAULT);
  });

  it('builds the legacy polyhedron for each key (detail 0, given radius)', () => {
    const expected: Record<string, unknown> = {
      '4': THREE.TetrahedronGeometry,
      '8': THREE.OctahedronGeometry,
      '20': THREE.IcosahedronGeometry,
    };
    for (const sides of GEM_SIDES) {
      const geo = GEM_SHAPES[sides](7) as THREE.PolyhedronGeometry;
      expect(geo).toBeInstanceOf(expected[sides]);
      expect(geo.parameters.radius).toBe(7);
      expect(geo.parameters.detail).toBe(0);
    }
  });
});

describe('buildGemGeometry()', () => {
  it('falls back to the default octahedron for an unknown/stale SIDES value', () => {
    const geo = buildGemGeometry('999', 5) as THREE.PolyhedronGeometry;
    expect(geo).toBeInstanceOf(THREE.OctahedronGeometry);
    expect(geo.parameters.radius).toBe(5);
    expect(geo.parameters.detail).toBe(0);
  });
});

describe('GEM.SIDES setting derivation', () => {
  it('options are exactly the GEM_SHAPES keys, in order', () => {
    const def = getFieldDef(GEM, 'SIDES');
    expect(def).toBeDefined();
    expect(def!.options!.map((o) => o.value)).toEqual(Object.keys(GEM_SHAPES));
  });

  it('default is the canonical default shape', () => {
    expect(getFieldDef(GEM, 'SIDES')!.default).toBe(GEM_SIDES_DEFAULT);
  });
});
