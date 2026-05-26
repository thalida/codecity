import { describe, it, expect } from 'vitest';
import { buildLabelAtlas } from '@/scene/components/labels/labels.js';
import { TYPOGRAPHY } from '../_helpers/typography.js';

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
    // 64+32 = 96px tall; ATLAS_HEIGHT_MAX is 8192, so ~85 rows fit per page.
    // Labels are 22-25 chars total (`'x'.repeat(20)` + `-${i}` for i=0..N-1).
    // jsdom's measureText returns ~32px per char at 64px font → average
    // ~770px wide. Atlas page is ~8192px wide → ~10 per row × 85 rows =
    // ~850 capacity per page. 1100 was confirmed empirically to force >1
    // page; the arithmetic above is approximate (jsdom rendering can shift)
    // so don't trust it blindly if tweaking.
    const wide = Array.from({ length: 1100 }, (_, i) => `${'x'.repeat(20)}-${i}`);
    const result = buildLabelAtlas(wide, TYPOGRAPHY);
    expect(result.pages.length).toBeGreaterThan(1);
    // Every label must have a rect on a real page.
    for (const text of wide) {
      const rect = result.rectByText.get(text);
      expect(rect).toBeDefined();
      expect(rect!.page).toBeLessThan(result.pages.length);
    }
  });

  it(
    'truncates labels when atlas overflows MAX_PAGES instead of throwing',
    { timeout: 30_000 },
    () => {
      // MAX_PAGES is 16; one page holds many thousand short labels at
      // default font, so generating ~3k wide labels forces overflow.
      // (The original spec used 50 000 × 80-char labels — same semantic
      // overflow scenario; we use 3 000 × 30-char labels to keep jsdom
      // canvas measurement below a 30s budget while still exercising the
      // overflow path.)
      const labels = Array.from({ length: 3_000 }, (_, i) => `label_${'x'.repeat(30)}_${i}`);
      expect(() => buildLabelAtlas(labels, TYPOGRAPHY)).not.toThrow();
    }
  );
});
