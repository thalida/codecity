import { describe, it, expect } from 'vitest';
import { getBuildingDimensions } from '@/city/layout/dimensions';
import { BUILDING_DIMENSIONS } from '@/state/stores/settings/buildings';

// Project ranges spanning tiny → multi-MB so binaries have room to scale.
const lineStats = { min: 1, max: 2000 };
const byteStats = { min: 100, max: 5_000_000 };

describe('getBuildingDimensions — binary "data" buildings', () => {
  it('sizes a binary on BOTH axes from bytes, not the lines stub', () => {
    const bigBin = getBuildingDimensions(
      { binary: true, lines: 0, size: 5_000_000 },
      lineStats,
      byteStats
    );
    const smallBin = getBuildingDimensions(
      { binary: true, lines: 0, size: 500 },
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

  it('a 0-line NON-binary file still collapses to the stub (binary branch is scoped)', () => {
    // Same 0 lines + big bytes, but not binary → lines-driven min-floors height.
    const codeStub = getBuildingDimensions(
      { binary: false, lines: 0, size: 5_000_000 },
      lineStats,
      byteStats
    );
    const bin = getBuildingDimensions(
      { binary: true, lines: 0, size: 5_000_000 },
      lineStats,
      byteStats
    );
    expect(bin.h).toBeGreaterThan(codeStub.h);
  });

  it('keeps a square footprint (depth == width)', () => {
    const b = getBuildingDimensions(
      { binary: true, lines: 0, size: 1_000_000 },
      lineStats,
      byteStats
    );
    expect(b.d).toBe(b.w);
  });
});
