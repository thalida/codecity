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
  it('returns at least one page + UV rect per text', () => {
    const result = buildLabelAtlas(['src', 'tests'], TYPOGRAPHY);
    expect(result.pages.length).toBeGreaterThan(0);
    expect(result.pages[0]).toBeInstanceOf(HTMLCanvasElement);
    expect(result.rectByText.size).toBe(2);
    expect(result.rectByText.get('src')?.page).toBe(0);
    expect(result.rectByText.get('tests')?.page).toBe(0);
  });

  it('rects are within [0,1] page-space and reference a valid page index', () => {
    const result = buildLabelAtlas(['a', 'b', 'c'], TYPOGRAPHY);
    for (const r of result.rectByText.values()) {
      expect(r.u).toBeGreaterThanOrEqual(0);
      expect(r.v).toBeGreaterThanOrEqual(0);
      expect(r.u + r.w).toBeLessThanOrEqual(1);
      expect(r.v + r.h).toBeLessThanOrEqual(1);
      expect(r.page).toBeGreaterThanOrEqual(0);
      expect(r.page).toBeLessThan(result.pages.length);
    }
  });

  it('handles empty input', () => {
    const result = buildLabelAtlas([], TYPOGRAPHY);
    expect(result.pages).toEqual([]);
    expect(result.rectByText.size).toBe(0);
  });

  it('paginates when one page would overflow', () => {
    // Generate enough labels to force at least 2 pages. Each label is
    // 64+32 = 96px tall; ATLAS_HEIGHT_MAX is 8192, so ~85 rows fit per
    // page. With ~5-char labels + padding the row holds many; we use
    // wide labels to force frequent row wraps.
    const wide = Array.from(
      { length: 1500 },
      (_, i) => `${'x'.repeat(20)}-${i}`,
    );
    const result = buildLabelAtlas(wide, TYPOGRAPHY);
    expect(result.pages.length).toBeGreaterThan(1);
    // Every label must have a rect on a real page.
    for (const text of wide) {
      const rect = result.rectByText.get(text);
      expect(rect).toBeDefined();
      expect(rect!.page).toBeLessThan(result.pages.length);
    }
  });

  it('throws when more than MAX_PAGES would be needed', () => {
    // MAX_PAGES is 16; one page holds many thousand short labels at
    // default font, so generating ~50k wide labels forces overflow.
    const enormous = Array.from(
      { length: 50000 },
      (_, i) => `${'x'.repeat(40)}-${i}`,
    );
    expect(() => buildLabelAtlas(enormous, TYPOGRAPHY)).toThrow(/atlas overflow/);
  });
});
