import { describe, it, expect } from 'vitest';
import { getBuildingDimensions } from '@/city/layout/dimensions';
import { BUILDING_DIMENSIONS } from '@/state/settings/fields/buildings';

// Project ranges spanning tiny → multi-MB so binaries have room to scale.
const lineStats = { min: 1, max: 2000 };
const byteStats = { min: 100, max: 5_000_000 };

describe('getBuildingDimensions — binary "data" buildings', () => {
  it('sizes a binary on BOTH axes from bytes, not the lines stub', () => {
    const bigBin = getBuildingDimensions(
      { binary: true, lines: 0, size: 5_000_000 },
      BUILDING_DIMENSIONS.value,
      lineStats,
      byteStats
    );
    const smallBin = getBuildingDimensions(
      { binary: true, lines: 0, size: 500 },
      BUILDING_DIMENSIONS.value,
      lineStats,
      byteStats
    );

    // Byte-driven on both axes: the big binary is wider AND taller.
    expect(bigBin.w).toBeGreaterThan(smallBin.w);
    expect(bigBin.h).toBeGreaterThan(smallBin.h);

    // It escapes the min-floors collapse a 0-line file used to hit.
    const dims = BUILDING_DIMENSIONS.value;
    const stubHeight = dims.MIN_FLOORS * dims.FLOOR_HEIGHT;
    expect(bigBin.h).toBeGreaterThan(stubHeight);
  });

  it('a 1-line NON-binary file still collapses to the stub (binary branch is scoped)', () => {
    // Same big bytes, but not binary → lines-driven min-floors height. 1 line,
    // not 0: a 0-line non-binary file is empty and gets the slab (see below).
    const codeStub = getBuildingDimensions(
      { binary: false, lines: 1, size: 5_000_000 },
      BUILDING_DIMENSIONS.value,
      lineStats,
      byteStats
    );
    const bin = getBuildingDimensions(
      { binary: true, lines: 0, size: 5_000_000 },
      BUILDING_DIMENSIONS.value,
      lineStats,
      byteStats
    );
    expect(bin.h).toBeGreaterThan(codeStub.h);
  });

  it('keeps a square footprint (depth == width)', () => {
    const b = getBuildingDimensions(
      { binary: true, lines: 0, size: 1_000_000 },
      BUILDING_DIMENSIONS.value,
      lineStats,
      byteStats
    );
    expect(b.d).toBe(b.w);
  });
});

describe('getBuildingDimensions — empty files', () => {
  const dims = () => BUILDING_DIMENSIONS.value;
  const slabHeight = () => Math.round(dims().EMPTY_SLAB_FLOORS * dims().FLOOR_HEIGHT * 10) / 10;

  it('renders a 0-byte file as a flat slab with no floors', () => {
    const empty = getBuildingDimensions(
      { lines: 0, size: 0 },
      BUILDING_DIMENSIONS.value,
      lineStats,
      byteStats
    );
    expect(empty.h).toBe(slabHeight());
    expect(empty.floors).toBe(0);
  });

  it('bypasses MIN_FLOORS rather than sitting at the bottom of its range', () => {
    const empty = getBuildingDimensions(
      { lines: 0, size: 0 },
      BUILDING_DIMENSIONS.value,
      lineStats,
      byteStats
    );
    const oneLiner = getBuildingDimensions(
      { lines: 1, size: 20 },
      BUILDING_DIMENSIONS.value,
      lineStats,
      byteStats
    );
    // The 1-line file is a legitimate short building; the empty one is not a building.
    expect(oneLiner.h).toBe(dims().MIN_FLOORS * dims().FLOOR_HEIGHT);
    expect(empty.h).toBeLessThan(oneLiner.h);
  });

  it('keeps the MIN_WIDTH footprint, square', () => {
    const empty = getBuildingDimensions(
      { lines: 0, size: 0 },
      BUILDING_DIMENSIONS.value,
      lineStats,
      byteStats
    );
    expect(empty.w).toBe(dims().MIN_WIDTH);
    expect(empty.d).toBe(empty.w);
  });

  it('empty wins over binary: a 0-byte blob is a slab, not a data block', () => {
    const emptyBin = getBuildingDimensions(
      { binary: true, lines: 0, size: 0 },
      BUILDING_DIMENSIONS.value,
      lineStats,
      byteStats
    );
    expect(emptyBin.h).toBe(slabHeight());
    expect(emptyBin.floors).toBe(0);
  });

  it('empty wins over media: a 0-byte image is a slab, not an aspect-sized poster', () => {
    const emptyImg = getBuildingDimensions(
      { binary: true, mediaKind: 'image', media_width: 800, media_height: 600, lines: 0, size: 0 },
      BUILDING_DIMENSIONS.value,
      lineStats,
      byteStats
    );
    expect(emptyImg.h).toBe(slabHeight());
    expect(emptyImg.floors).toBe(0);
  });
});
