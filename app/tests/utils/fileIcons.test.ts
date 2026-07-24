import { describe, it, expect } from 'vitest';
import { getFileIconName } from '@/utils/fileIcons';
import { GENERIC_BINARY } from '@/constants/fileIcons';

describe('getFileIconName — binary data files', () => {
  it('returns the shared binary glyph for a binary, non-media file', () => {
    expect(getFileIconName({ name: 'app.db', extension: '.db', binary: true })).toBe(
      GENERIC_BINARY
    );
    expect(getFileIconName({ name: 'lib.wasm', extension: '.wasm', binary: true })).toBe(
      GENERIC_BINARY
    );
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
