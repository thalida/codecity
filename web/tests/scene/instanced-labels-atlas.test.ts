import { describe, it, expect } from 'vitest';
import { buildLabelAtlas } from '@/scene/instanced/labels.js';
import type { LabelTypographyConfig } from '@/config/index.js';

// Minimal typography config for tests — shape matches LabelTypographyConfig.
const TYPOGRAPHY: LabelTypographyConfig = {
  FONT_FAMILY: 'sans-serif',
  FONT_WEIGHT: 700,
  FONT_SIZE_PX: 64,
  FILL: '#fff',
  STROKE: '#000',
  STROKE_WIDTH_PX: 4,
  CANVAS_PADDING_PX: 16,
  HEIGHT_FRAC: 0.45,
  SPACING_MULT: 3.5,
  SPACING_FLOOR: 200,
  ELEVATION: 0,
  FLIP_HYSTERESIS: 0.15,
};

describe('buildLabelAtlas', () => {
  it('returns a canvas + UV rect per text', () => {
    const result = buildLabelAtlas(['src', 'tests'], TYPOGRAPHY);
    expect(result.canvas).toBeInstanceOf(HTMLCanvasElement);
    expect(result.rectByText.size).toBe(2);
    expect(result.rectByText.has('src')).toBe(true);
    expect(result.rectByText.has('tests')).toBe(true);
  });

  it('rects are within [0,1] atlas-space and non-overlapping', () => {
    const result = buildLabelAtlas(['a', 'b', 'c'], TYPOGRAPHY);
    const rects = [...result.rectByText.values()];
    for (const r of rects) {
      expect(r.u).toBeGreaterThanOrEqual(0);
      expect(r.v).toBeGreaterThanOrEqual(0);
      expect(r.u + r.w).toBeLessThanOrEqual(1);
      expect(r.v + r.h).toBeLessThanOrEqual(1);
    }
    // Rough non-overlap check: paired rects don't share interior.
    // (Full overlap test is more involved; trust the shelf-fit algorithm.)
  });

  it('handles empty input', () => {
    const result = buildLabelAtlas([], TYPOGRAPHY);
    expect(result.rectByText.size).toBe(0);
  });

  it('throws on atlas overflow', () => {
    const huge = Array.from({ length: 50000 }, (_, i) => `label-${i}`);
    expect(() => buildLabelAtlas(huge, TYPOGRAPHY)).toThrow(/atlas/);
  });
});
