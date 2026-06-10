// palette.test.ts — verifies the gem face-palette flatten + hex→rgb parse.

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';

import { paletteColors, type GemFacePalette } from '@/city/components/gem/palette';

const PALETTE: GemFacePalette = {
  FACE_1: '#ff0000',
  FACE_2: '#00ff00',
  FACE_3: '#0000ff',
  FACE_4: '#ffff00',
  FACE_5: '#ff00ff',
  FACE_6: '#00ffff',
  FACE_7: '#ffffff',
  FACE_8: '#5e8a3a',
};

describe('paletteColors()', () => {
  it('flattens FACE_1..FACE_8 in order', () => {
    const colors = paletteColors(PALETTE);
    expect(colors).toHaveLength(8);
    // First three primaries pin the ordering: any shuffle of the flatten
    // would repaint the gem's faces in a different rotation.
    expect(colors[0]).toEqual([1, 0, 0]);
    expect(colors[1]).toEqual([0, 1, 0]);
    expect(colors[2]).toEqual([0, 0, 1]);
  });

  it('parses each hex exactly like new THREE.Color(hex)', () => {
    // The consumers (geometry color attribute, glow lerp) previously built
    // THREE.Colors inline; the helper must reproduce that parse bit-for-bit
    // so the rendered colors are unchanged.
    const colors = paletteColors(PALETTE);
    const reference = new THREE.Color(PALETTE.FACE_8);
    expect(colors[7][0]).toBe(reference.r);
    expect(colors[7][1]).toBe(reference.g);
    expect(colors[7][2]).toBe(reference.b);
  });
});
