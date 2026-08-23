// Per-author color from the backend's AuthorStat.hue, at a fixed
// lightness/chroma so every author reads against the dark sky. Shared by the
// commit pane's dot and the fireflies renderer's orbs.

import { oklchToLinearRgb, linearRgbToHex } from '@/city/scene/utils/color/colors';

// Base palette used for firefly orbs — saturated, mid-lightness.
const ORB_L = 0.78;
const ORB_C = 0.18;
// The hover ring: same hue and chroma, only the lightness lifts. Going pastel
// washes it toward white and loses the hue, which is the author's identity.
const LIGHT_L = 0.84;
const LIGHT_C = 0.18;

export interface AuthorColor {
  hex: string; // "#rrggbb"
  hue: number; // degrees [0, 360)
  // readonly: memoized and aliased into every orb of this author.
  rgb: readonly [number, number, number]; // linear-light, 0..1 each
}

// Memoized by hue+lightness+chroma: far fewer authors than orbs, so this is one
// OKLCH conversion per author rather than per orb. The value is shared.
const _colorCache = new Map<string, AuthorColor>();
// Bounded so a long session across many repos cannot grow it without limit.
// Clearing is safe: every value is a pure function of its key.
const _COLOR_CACHE_MAX = 1 << 16;

function authorColorAt(hue: number, l: number, c: number): AuthorColor {
  const key = `${l}:${c}:${hue}`;
  const cached = _colorCache.get(key);
  if (cached) return cached;
  const rgb = oklchToLinearRgb(l, c, hue);
  const color: AuthorColor = { hex: linearRgbToHex(rgb), hue, rgb };
  if (_colorCache.size >= _COLOR_CACHE_MAX) _colorCache.clear();
  _colorCache.set(key, color);
  return color;
}

export function colorForAuthor(hue: number): AuthorColor {
  return authorColorAt(hue, ORB_L, ORB_C);
}

/** Pastel `colorForAuthor`: the hovered orbit ring, so it still reads as that
 *  author's, in a softer tone. */
export function lightColorForAuthor(hue: number): AuthorColor {
  return authorColorAt(hue, LIGHT_L, LIGHT_C);
}
