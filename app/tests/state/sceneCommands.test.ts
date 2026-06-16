import { describe, it, expect } from 'vitest';
import { selectCommit, focusCommit } from '@/state/stores/scene';

describe('scene commit commands', () => {
  it('selectCommit is a no-op (no throw) before the scene boots', () => {
    expect(() => selectCommit('deadbeef')).not.toThrow();
  });
  it('focusCommit is a no-op (no throw) before the scene boots', () => {
    expect(() => focusCommit('deadbeef')).not.toThrow();
  });
});
