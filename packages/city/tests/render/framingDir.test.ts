import { describe, it, expect } from 'vitest';
import { computeFramingDir } from '@/city/render/framingDir';
import { StreetAxis } from '@/city/types/street';

const DEG = Math.PI / 180;

describe('computeFramingDir', () => {
  it('returns a unit vector for every axis', () => {
    for (const axis of [StreetAxis.X, StreetAxis.Y, null]) {
      expect(computeFramingDir(44, 17, axis).length()).toBeCloseTo(1, 6);
    }
  });

  it('dir.y encodes elevation (sin) independent of azimuth/axis', () => {
    for (const axis of [StreetAxis.X, StreetAxis.Y, null]) {
      expect(computeFramingDir(44, 17, axis).y).toBeCloseTo(Math.sin(44 * DEG), 6);
    }
  });

  it('reproduces the legacy X-oriented framing (Vector3(-1, 1, 0.3))', () => {
    // Legacy dir was new THREE.Vector3(-1, 1.0, 0.3).normalize() ≈ 43.75° / 16.7°.
    const d = computeFramingDir(43.75, 16.7, StreetAxis.X);
    expect(d.x).toBeCloseTo(-0.6917, 2);
    expect(d.y).toBeCloseTo(0.6917, 2);
    expect(d.z).toBeCloseTo(0.2075, 2);
  });

  it('azimuth 0 looks straight down the street (no lateral component)', () => {
    expect(computeFramingDir(44, 0, StreetAxis.X).z).toBeCloseTo(0, 6); // lateral is Z
    expect(computeFramingDir(44, 0, StreetAxis.Y).x).toBeCloseTo(0, 6); // lateral is X
  });

  it('90° elevation points straight down', () => {
    const d = computeFramingDir(90, 30, StreetAxis.X);
    expect(d.y).toBeCloseTo(1, 6);
    expect(d.x).toBeCloseTo(0, 6);
    expect(d.z).toBeCloseTo(0, 6);
  });
});
