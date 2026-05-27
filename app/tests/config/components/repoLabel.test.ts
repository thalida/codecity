import { describe, it, expect, beforeEach } from 'vitest';
import { REPO_LABEL } from '@/config/components/repoLabel.js';

describe('REPO_LABEL config store', () => {
  beforeEach(() => {
    REPO_LABEL.set({
      ENABLED: true,
      HEIGHT_PCT: 85,
      FONT_SIZE: 128,
      ANIMATION_SPEED: 1.0,
      OPACITY: 0.9,
      BEAM_COLOR: '#bfb3ff',
      TEXT_COLOR: '#ffffff',
    });
  });

  it('exposes the documented default shape', () => {
    expect(REPO_LABEL.get()).toEqual({
      ENABLED: true,
      HEIGHT_PCT: 85,
      FONT_SIZE: 128,
      ANIMATION_SPEED: 1.0,
      OPACITY: 0.9,
      BEAM_COLOR: '#bfb3ff',
      TEXT_COLOR: '#ffffff',
    });
  });
});
