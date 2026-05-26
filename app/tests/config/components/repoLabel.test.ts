import { describe, it, expect, beforeEach } from 'vitest';
import { REPO_LABEL } from '@/config/components/repoLabel.js';

describe('REPO_LABEL config store', () => {
  beforeEach(() => {
    REPO_LABEL.set({
      ENABLED: true,
      HEIGHT: 1305,
      FONT_SIZE: 96,
      ANIMATION_SPEED: 1.0,
      OPACITY: 0.9,
    });
  });

  it('exposes the documented default shape', () => {
    expect(REPO_LABEL.get()).toEqual({
      ENABLED: true,
      HEIGHT: 1305,
      FONT_SIZE: 96,
      ANIMATION_SPEED: 1.0,
      OPACITY: 0.9,
    });
  });
});
