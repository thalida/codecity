// palette.test.ts — verifies the gem face-palette flatten + hex→rgb parse,
// and the memoization of the live-store computed.

import { describe, it, expect, afterEach } from 'vitest';
import * as THREE from 'three';

import { paletteColors, gemFaceColors, type GemFacePalette } from '@/city/components/gem/palette';
import { GEM } from '@/state/settings/fields/gem';

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
    // The geometry color attribute and the glow lerp both feed THREE's own
    // parse, so any drift here shifts the rendered colours.
    const colors = paletteColors(PALETTE);
    const reference = new THREE.Color(PALETTE.FACE_8);
    expect(colors[7][0]).toBe(reference.r);
    expect(colors[7][1]).toBe(reference.g);
    expect(colors[7][2]).toBe(reference.b);
  });
});

describe('gemFaceColors (memoized computed)', () => {
  const originalGem = GEM.value;

  afterEach(() => {
    GEM.value = originalGem;
  });

  it('caches the parsed array between reads (no per-frame reparse)', () => {
    // tick() reads this every frame while the glow color cycle is on; the
    // computed must hand back the SAME array until GEM actually changes.
    const first = gemFaceColors.value;
    const second = gemFaceColors.value;
    expect(second).toBe(first);
  });

  it('recomputes (new identity, fresh values) after a GEM Save', () => {
    const before = gemFaceColors.value;
    GEM.value = { ...GEM.value, FACE_1: '#123456' };
    const after = gemFaceColors.value;
    expect(after).not.toBe(before);
    const reference = new THREE.Color('#123456');
    expect(after[0]).toEqual([reference.r, reference.g, reference.b]);
  });
});
