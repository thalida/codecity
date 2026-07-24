import { describe, it, expect } from 'vitest';
import { getFileIconName } from '@/utils/fileIcons';
import { GENERIC_BINARY } from '@/constants/fileIcons';

describe('getFileIconName — binary data files', () => {
  it('keeps a known binary type on its own icon, not the hex fallback', () => {
    expect(getFileIconName({ name: 'song.mp3', extension: '.mp3', binary: true })).toBe('audio');
    expect(getFileIconName({ name: 'x.ttf', extension: '.ttf', binary: true })).toBe('font');
    expect(getFileIconName({ name: 'app.db', extension: '.db', binary: true })).toBe('database');
  });

  it('falls back to the hex glyph only for an unmatched binary', () => {
    expect(getFileIconName({ name: 'blob.bin', extension: '.bin', binary: true })).toBe(
      GENERIC_BINARY
    );
    expect(getFileIconName({ name: 'data', extension: '', binary: true })).toBe(GENERIC_BINARY);
  });

  it('leaves media (billboards) and code on their own icons', () => {
    expect(
      getFileIconName({ name: 'pic.png', extension: '.png', binary: true, mediaKind: 'image' })
    ).not.toBe(GENERIC_BINARY);
    expect(getFileIconName({ name: 'main.ts', extension: '.ts', binary: false })).not.toBe(
      GENERIC_BINARY
    );
  });
});
