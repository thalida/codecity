import { describe, it, expect } from 'vitest';
import { colorForAuthor } from '@/scene/components/fireflies/authorColor';

describe('colorForAuthor', () => {
  it('returns the same hex for the same name across calls', () => {
    const a = colorForAuthor('Alice');
    const b = colorForAuthor('Alice');
    expect(a.hex).toBe(b.hex);
  });

  it('returns valid #rrggbb hex strings', () => {
    for (const name of ['Alice', 'Bob', 'Charlie', '', 'Yan 🚀 Müller']) {
      const { hex } = colorForAuthor(name);
      expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('handles unicode names without throwing', () => {
    expect(() => colorForAuthor('Test 👤 Üser')).not.toThrow();
  });

  it('distributes hues roughly uniformly across many names', () => {
    // 360 buckets, 3600 samples → ~10 per bucket. Allow generous slack.
    const buckets = new Array<number>(36).fill(0);
    for (let i = 0; i < 3600; i++) {
      const hue = colorForAuthor(`user-${i}`).hue;
      buckets[Math.floor(hue / 10)]++;
    }
    // No bucket should be empty (would indicate severe clustering).
    expect(buckets.every((b) => b > 0)).toBe(true);
  });

  it('different short names typically produce different colors', () => {
    // Allow some collisions (1/360 chance per pair) but most should differ.
    const distinct = new Set<string>();
    for (let i = 0; i < 100; i++) {
      distinct.add(colorForAuthor(`x${i}`).hex);
    }
    expect(distinct.size).toBeGreaterThan(80);
  });
});
