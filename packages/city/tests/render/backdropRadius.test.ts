// The turntable's orbit radius. One setting has to mean one framing on every
// repo, which is what counting in the gem's own framing distance is for: the
// city's extent grows with the project, so measuring in that put the same value
// on top of a small repo and miles off a large one.

import { describe, it, expect } from 'vitest';
import { backdropRadius } from '../../src/render/backdropRadius';

const LIMITS = { minDistance: 1, maxDistance: 100000 };

const geometry = (gemFitDistance: number | null, gemRadius = 0) => ({
  gemFitDistance,
  gemRadius,
  worldBounds: null,
});

describe('backdropRadius', () => {
  it('sits at the default camera distance at 1', () => {
    expect(backdropRadius(1, LIMITS, geometry(800))).toBe(800);
  });

  it('scales linearly, so half the value is half the distance', () => {
    expect(backdropRadius(0.5, LIMITS, geometry(800))).toBe(400);
    expect(backdropRadius(2, LIMITS, geometry(800))).toBe(1600);
  });

  it('holds the same framing across projects of wildly different size', () => {
    // The unit is tier-bounded, so two repos an order of magnitude apart in
    // file count land near each other. The city's own extent would not.
    const small = backdropRadius(0.1, LIMITS, geometry(600));
    const huge = backdropRadius(0.1, LIMITS, geometry(900));
    expect(huge / small).toBeCloseTo(1.5); // the tier spread, not the repo spread
    expect(huge - small).toBeLessThan(600); // and never an order of magnitude
  });

  it('never puts the camera inside the gem', () => {
    expect(backdropRadius(0, LIMITS, geometry(800, 12))).toBe(12);
  });

  it('holds inside the limits a hand-driven camera has', () => {
    expect(backdropRadius(2, { minDistance: 1, maxDistance: 50 }, geometry(800))).toBe(50);
    expect(backdropRadius(0, { minDistance: 30, maxDistance: 50 }, geometry(800))).toBe(30);
  });

  it('falls back to the island before a city is built', () => {
    const radius = backdropRadius(1, LIMITS, {
      gemRadius: null,
      gemFitDistance: null,
      worldBounds: { halfWidth: 30, halfDepth: 40 } as never,
    });
    expect(radius).toBeCloseTo(50);
  });
});
