import { describe, it, expect } from 'vitest';
import { colorForAuthor, lightColorForAuthor } from '../../../src/components/fireflies/authorColor';

// The name -> hue hash lives on the backend now (AuthorStat.hue, covered by
// api/tests/test_stats.py). What's left here is hue -> display colour.
describe('colorForAuthor', () => {
  it('returns the same object for the same hue across calls', () => {
    expect(colorForAuthor(200)).toBe(colorForAuthor(200));
  });

  it('returns valid #rrggbb hex across the hue circle', () => {
    for (const hue of [0, 45, 120, 200, 359]) {
      expect(colorForAuthor(hue).hex).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('keeps the hue it was given, and distinct hues give distinct colours', () => {
    expect(colorForAuthor(137).hue).toBe(137);
    const distinct = new Set<string>();
    for (let hue = 0; hue < 360; hue += 10) distinct.add(colorForAuthor(hue).hex);
    expect(distinct.size).toBe(36);
  });

  it('the light variant shares the hue but lifts lightness', () => {
    const orb = colorForAuthor(200);
    const light = lightColorForAuthor(200);
    expect(light.hue).toBe(orb.hue);
    expect(light.hex).not.toBe(orb.hex);
  });
});
