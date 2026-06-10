import * as THREE from 'three';
import { describe, it, expect } from 'vitest';
import { writeSunDir, sunDir } from '@/city/utils/lighting/sunDir';

// sunDir is pure math: (azimuthDeg, elevationDeg) → unit world-space direction
// toward the sun. Tests pass the angles directly (the production sun position
// is the fixed LIGHTING_* constants in constants/lighting).

describe('writeSunDir', () => {
  it('reproduces the legacy normalize(0.5, 1.0, 0.4) at az=51 el=58', () => {
    const out = new THREE.Vector3();
    writeSunDir(out, 51, 58);
    // normalize(0.5, 1.0, 0.4) ≈ (0.4211, 0.8422, 0.3369)
    expect(out.x).toBeCloseTo(0.4211, 1);
    expect(out.y).toBeCloseTo(0.8422, 1);
    expect(out.z).toBeCloseTo(0.3369, 1);
    expect(out.length()).toBeCloseTo(1, 5);
  });

  it('points straight up at elevation=90', () => {
    const out = new THREE.Vector3();
    writeSunDir(out, 51, 90);
    expect(out.y).toBeCloseTo(1, 5);
    expect(out.x).toBeCloseTo(0, 5);
    expect(out.z).toBeCloseTo(0, 5);
  });

  it('azimuth=0 elevation=0 points along +Z (south)', () => {
    const out = new THREE.Vector3();
    writeSunDir(out, 0, 0);
    expect(out.x).toBeCloseTo(0, 5);
    expect(out.y).toBeCloseTo(0, 5);
    expect(out.z).toBeCloseTo(1, 5);
  });

  it('azimuth=90 elevation=0 points along +X (east)', () => {
    const out = new THREE.Vector3();
    writeSunDir(out, 90, 0);
    expect(out.x).toBeCloseTo(1, 5);
    expect(out.z).toBeCloseTo(0, 5);
  });
});

describe('sunDir', () => {
  it('returns a fresh unit Vector3 matching writeSunDir output', () => {
    const v = sunDir(51, 58);
    expect(v).toBeInstanceOf(THREE.Vector3);
    expect(v.length()).toBeCloseTo(1, 5);
    expect(v.y).toBeCloseTo(0.8422, 1);
  });

  it('different sun angles produce different directions', () => {
    const a = sunDir(51, 58);
    const b = sunDir(141, 58); // +90° azimuth
    expect(a.distanceTo(b)).toBeGreaterThan(0.001);
  });
});
