import { describe, it, expect, beforeEach } from 'vitest';
import { getWorldFloorSize, getWorldFloorHalfSize } from '@/scene/parks/worldBounds.js';
import { CAMERA_PERSPECTIVE } from '@/config/view.js';

describe('worldBounds', () => {
  beforeEach(() => {
    CAMERA_PERSPECTIVE.setKey('FAR', 5000);
  });

  it('floor size is 4× camera FAR', () => {
    expect(getWorldFloorSize()).toBe(20000);
  });

  it('half size is half the full size', () => {
    expect(getWorldFloorHalfSize()).toBe(10000);
  });

  it('tracks camera FAR changes', () => {
    CAMERA_PERSPECTIVE.setKey('FAR', 10000);
    expect(getWorldFloorSize()).toBe(40000);
  });
});
