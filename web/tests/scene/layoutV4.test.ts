import { describe, expect, it } from 'vitest';
import { StreetAxis } from '@/types';
import { applyFlips, computeFlips, isMirrorInvariant } from '@/scene/layoutV4';

describe('computeFlips', () => {
  it('X-orient parent, side 0, no mirror: flipY only', () => {
    expect(computeFlips(StreetAxis.X, 0, false)).toEqual({ flipX: false, flipY: true });
  });
  it('X-orient parent, side 1, no mirror: no flip', () => {
    expect(computeFlips(StreetAxis.X, 1, false)).toEqual({ flipX: false, flipY: false });
  });
  it('X-orient parent, side 1, mirror: flipX only', () => {
    expect(computeFlips(StreetAxis.X, 1, true)).toEqual({ flipX: true, flipY: false });
  });
  it('X-orient parent, side 0, mirror: both flips', () => {
    expect(computeFlips(StreetAxis.X, 0, true)).toEqual({ flipX: true, flipY: true });
  });
  it('Y-orient parent, side 0, no mirror: flipX only', () => {
    expect(computeFlips(StreetAxis.Y, 0, false)).toEqual({ flipX: true, flipY: false });
  });
  it('Y-orient parent, side 1, mirror: flipY only', () => {
    expect(computeFlips(StreetAxis.Y, 1, true)).toEqual({ flipX: false, flipY: true });
  });
});

describe('applyFlips', () => {
  it('no flips: rect unchanged', () => {
    expect(applyFlips({ x: 10, y: 20, w: 3, d: 4 }, false, false)).toEqual({
      x: 10, y: 20, w: 3, d: 4,
    });
  });
  it('flipX: negates x center, w/d unchanged', () => {
    expect(applyFlips({ x: 10, y: 20, w: 3, d: 4 }, true, false)).toEqual({
      x: -10, y: 20, w: 3, d: 4,
    });
  });
  it('flipY: negates y center, w/d unchanged', () => {
    expect(applyFlips({ x: 10, y: 20, w: 3, d: 4 }, false, true)).toEqual({
      x: 10, y: -20, w: 3, d: 4,
    });
  });
  it('both flips: negates both centers', () => {
    expect(applyFlips({ x: 10, y: 20, w: 3, d: 4 }, true, true)).toEqual({
      x: -10, y: -20, w: 3, d: 4,
    });
  });
});

describe('isMirrorInvariant', () => {
  it('empty list is invariant', () => {
    expect(isMirrorInvariant([], StreetAxis.X)).toBe(true);
  });
  it('single rect on the parent centerline (x=0) is X-mirror-invariant', () => {
    expect(isMirrorInvariant([{ x: 0, y: 10, w: 5, d: 5 }], StreetAxis.X)).toBe(true);
  });
  it('single off-centerline rect is NOT X-mirror-invariant', () => {
    expect(isMirrorInvariant([{ x: 5, y: 10, w: 5, d: 5 }], StreetAxis.X)).toBe(false);
  });
  it('paired off-centerline rects (mirror images) ARE X-mirror-invariant', () => {
    expect(
      isMirrorInvariant(
        [
          { x: 5, y: 10, w: 5, d: 5 },
          { x: -5, y: 10, w: 5, d: 5 },
        ],
        StreetAxis.X
      )
    ).toBe(true);
  });
  it('Y-orient parent: pairs mirrored across Y are invariant', () => {
    expect(
      isMirrorInvariant(
        [
          { x: 10, y: 5, w: 5, d: 5 },
          { x: 10, y: -5, w: 5, d: 5 },
        ],
        StreetAxis.Y
      )
    ).toBe(true);
  });
});
