import { describe, it, expect } from 'vitest';
import { sourceKey, CURRENT_SOURCE_KEY } from '@/state/runtime/activeSource';

describe('sourceKey', () => {
  it('is deterministic for the same (src, branch)', () => {
    expect(sourceKey('/foo', 'main')).toBe(sourceKey('/foo', 'main'));
  });

  it('distinguishes branches', () => {
    expect(sourceKey('/foo', 'main')).not.toBe(sourceKey('/foo', 'develop'));
  });

  it('distinguishes (src, undefined) from (src, "main")', () => {
    expect(sourceKey('/foo')).not.toBe(sourceKey('/foo', 'main'));
  });

  it('produces a short alphanumeric string', () => {
    const k = sourceKey('/Users/example/repos/codecity');
    expect(k).toMatch(/^[a-z0-9]{1,10}$/);
  });
});

describe('CURRENT_SOURCE_KEY', () => {
  it('starts as null', () => {
    expect(CURRENT_SOURCE_KEY.value).toBeNull();
  });

  it('can be set and read', () => {
    CURRENT_SOURCE_KEY.value = 'abc123';
    expect(CURRENT_SOURCE_KEY.value).toBe('abc123');
    CURRENT_SOURCE_KEY.value = null;
  });
});
