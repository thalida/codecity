import { describe, it, expect } from 'vitest';
import { languageLabelForExt } from '@/utils/syntaxLanguages';

describe('languageLabelForExt', () => {
  it('maps a known extension to its display label', () => {
    expect(languageLabelForExt('.ts')).toBe('TypeScript');
    expect(languageLabelForExt('.py')).toBe('Python');
  });

  it('is case-insensitive on the extension', () => {
    expect(languageLabelForExt('.TS')).toBe('TypeScript');
  });

  it('falls back to the uppercased extension when no language matches', () => {
    expect(languageLabelForExt('.exr')).toBe('EXR');
  });

  it('returns null for a missing extension (empty or null)', () => {
    expect(languageLabelForExt('')).toBeNull();
    expect(languageLabelForExt(null)).toBeNull();
  });
});
