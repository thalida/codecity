import * as THREE from 'three';
import { describe, it, expect, beforeEach } from 'vitest';
import { writeSunDir, sunDirFromLighting } from '@/scene/components/lighting/sunDir.js';
import { LIGHTING } from '@/config/lighting.js';

describe('writeSunDir', () => {
  beforeEach(() => {
    LIGHTING.set({
      SUN_AZIMUTH_DEG: 51,
      SUN_ELEVATION_DEG: 58,
      AMBIENT: 0.72,
      SUN_CONTRAST: 0.5,
    });
  });

  it('reproduces the legacy normalize(0.5, 1.0, 0.4) to within rounding', () => {
    const out = new THREE.Vector3();
    writeSunDir(out);
    // normalize(0.5, 1.0, 0.4) ≈ (0.4211, 0.8422, 0.3369)
    expect(out.x).toBeCloseTo(0.4211, 1);
    expect(out.y).toBeCloseTo(0.8422, 1);
    expect(out.z).toBeCloseTo(0.3369, 1);
    expect(out.length()).toBeCloseTo(1, 5);
  });

  it('points straight up at elevation=90', () => {
    LIGHTING.setKey('SUN_ELEVATION_DEG', 90);
    const out = new THREE.Vector3();
    writeSunDir(out);
    expect(out.y).toBeCloseTo(1, 5);
    expect(out.x).toBeCloseTo(0, 5);
    expect(out.z).toBeCloseTo(0, 5);
  });

  it('azimuth=0 elevation=0 points along +Z (south)', () => {
    LIGHTING.set({
      SUN_AZIMUTH_DEG: 0,
      SUN_ELEVATION_DEG: 0,
      AMBIENT: 0.72,
      SUN_CONTRAST: 0.5,
    });
    const out = new THREE.Vector3();
    writeSunDir(out);
    expect(out.x).toBeCloseTo(0, 5);
    expect(out.y).toBeCloseTo(0, 5);
    expect(out.z).toBeCloseTo(1, 5);
  });

  it('azimuth=90 elevation=0 points along +X (east)', () => {
    LIGHTING.set({
      SUN_AZIMUTH_DEG: 90,
      SUN_ELEVATION_DEG: 0,
      AMBIENT: 0.72,
      SUN_CONTRAST: 0.5,
    });
    const out = new THREE.Vector3();
    writeSunDir(out);
    expect(out.x).toBeCloseTo(1, 5);
    expect(out.z).toBeCloseTo(0, 5);
  });
});

describe('sunDirFromLighting', () => {
  beforeEach(() => {
    LIGHTING.set({
      SUN_AZIMUTH_DEG: 51,
      SUN_ELEVATION_DEG: 58,
      AMBIENT: 0.72,
      SUN_CONTRAST: 0.5,
    });
  });

  it('returns a fresh unit Vector3 matching writeSunDir output', () => {
    const v = sunDirFromLighting();
    expect(v).toBeInstanceOf(THREE.Vector3);
    expect(v.length()).toBeCloseTo(1, 5);
    expect(v.y).toBeCloseTo(0.8422, 1);
  });
});
