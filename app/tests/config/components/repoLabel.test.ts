import { describe, it, expect, beforeEach } from 'vitest';
import { REPO_LABEL } from '@/config/components/repoLabel.js';

describe('REPO_LABEL config store', () => {
  beforeEach(() => {
    REPO_LABEL.set({
      ENABLED: true,
      STYLE: 'ring',
      HEIGHT_ABOVE_CITY: 18,
      ANIMATION_SPEED: 1.0,
      OPACITY: 0.9,
    });
  });

  it('exposes the documented default shape', () => {
    expect(REPO_LABEL.get()).toEqual({
      ENABLED: true,
      STYLE: 'ring',
      HEIGHT_ABOVE_CITY: 18,
      ANIMATION_SPEED: 1.0,
      OPACITY: 0.9,
    });
  });

  it('accepts each valid STYLE value', () => {
    REPO_LABEL.setKey('STYLE', 'hologram');
    expect(REPO_LABEL.get().STYLE).toBe('hologram');
    REPO_LABEL.setKey('STYLE', 'concentric');
    expect(REPO_LABEL.get().STYLE).toBe('concentric');
    REPO_LABEL.setKey('STYLE', 'ring');
    expect(REPO_LABEL.get().STYLE).toBe('ring');
  });
});
