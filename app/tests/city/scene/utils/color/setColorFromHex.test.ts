// setColorFromHex.test.ts — verifies the raw-bytes (no sRGB→linear) hex write.

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { setColorFromHex } from '@/city/scene/utils/color/setColorFromHex';

describe('setColorFromHex()', () => {
  it('writes hex bytes through unchanged (no sRGB→linear conversion)', () => {
    const c = new THREE.Color();
    setColorFromHex(c, '#ff8000');
    // Raw byte values normalized to [0,1] — NOT gamma-decoded. A default
    // setStyle would decode 0x80 ≈ 0.5 down to ≈ 0.216.
    expect(c.r).toBeCloseTo(1.0, 6);
    expect(c.g).toBeCloseTo(0x80 / 0xff, 6);
    expect(c.b).toBeCloseTo(0.0, 6);
  });

  it('matches setStyle with LinearSRGBColorSpace, not the default', () => {
    const viaHelper = new THREE.Color();
    setColorFromHex(viaHelper, '#5e8a3a');

    const linear = new THREE.Color().setStyle('#5e8a3a', THREE.LinearSRGBColorSpace);
    expect(viaHelper.getHex(THREE.LinearSRGBColorSpace)).toBe(
      linear.getHex(THREE.LinearSRGBColorSpace)
    );

    // The default-converted form differs, so "fixing" the helper to use it
    // would wash out every consumer's palette.
    const converted = new THREE.Color().setStyle('#5e8a3a');
    expect(viaHelper.equals(converted)).toBe(false);
  });

  it('mutates the passed target in place', () => {
    const c = new THREE.Color(0x123456);
    setColorFromHex(c, '#ffffff');
    expect(c.r).toBe(1);
    expect(c.g).toBe(1);
    expect(c.b).toBe(1);
  });
});
