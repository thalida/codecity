import { describe, it, expect } from 'vitest';
import { isEmptyFile } from '@/utils/emptyKind';

describe('isEmptyFile', () => {
  it('is true for a 0-byte text file', () => {
    expect(isEmptyFile({ size: 0, lines: 0, binary: false })).toBe(true);
  });

  it('is true for a 0-byte binary or media file (empty wins over kind)', () => {
    expect(isEmptyFile({ size: 0, lines: 0, binary: true })).toBe(true);
    expect(isEmptyFile({ size: 0, lines: 0, binary: true, mediaKind: 'image' })).toBe(true);
  });

  it('is false for a file with content', () => {
    expect(isEmptyFile({ size: 100, lines: 5, binary: false })).toBe(false);
  });

  it('is false for a non-empty binary, which reports lines=0 by design', () => {
    expect(isEmptyFile({ size: 5000, lines: 0, binary: true })).toBe(false);
  });

  it('is false for a non-empty media file, which also reports lines=0', () => {
    expect(isEmptyFile({ size: 2000, lines: 0, binary: true, mediaKind: 'image' })).toBe(false);
  });

  it('is true for a text file replayed to 0 lines, whose union `size` is non-zero', () => {
    // Timeline: getBuildingDimensions is called with {...file, lines: linesAt(pos)}.
    // The union node's `size` is a max-over-history footprint, not the size at
    // this commit, so only the replayed `lines` can say the file was empty here.
    expect(isEmptyFile({ size: 500, lines: 0, binary: false })).toBe(true);
  });

  it('is false for null / undefined', () => {
    expect(isEmptyFile(null)).toBe(false);
    expect(isEmptyFile(undefined)).toBe(false);
  });
});
