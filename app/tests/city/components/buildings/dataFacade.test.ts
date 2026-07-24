import { describe, it, expect } from 'vitest';
import { dataFacadeKind } from '@/city/components/buildings/dataFacade';

describe('dataFacadeKind', () => {
  it('routes fonts to a glyph, audio to a waveform, everything else to the fingerprint', () => {
    for (const ext of ['.woff2', '.woff', '.ttf', '.otf', '.TTF']) {
      expect(dataFacadeKind(ext)).toBe('font');
    }
    for (const ext of ['.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a', '.MP3']) {
      expect(dataFacadeKind(ext)).toBe('audio');
    }
    for (const ext of ['.db', '.wasm', '.so', '.bin', '']) {
      expect(dataFacadeKind(ext)).toBe('fingerprint');
    }
  });
});
