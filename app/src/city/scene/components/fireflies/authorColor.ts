// Per-author color from the backend's AuthorStat.hue, at a fixed
// lightness/chroma so every author reads against the dark sky. Shared by the
// commit pane's dot and the fireflies renderer's orbs.

import { oklchToLinearRgb, linearRgbToHex } from '@/city/scene/utils/color/colors';

// Base palette used for firefly orbs — saturated, mid-lightness.
const ORB_L = 0.78;
const ORB_C = 0.18;
// Brighter variant used for orbit-ring hover highlights — same hue +
// chroma as the orb (so the author's identity stays recognizable), only
// the lightness lifts. Going too pastel (lower chroma, much higher L)
// washes the ring toward white and loses the hue, which is exactly
// the wrong signal for "this is author X's orbit".
const LIGHT_L = 0.84;
const LIGHT_C = 0.18;

export interface AuthorColor {
  hex: string; // "#rrggbb"
  hue: number; // degrees [0, 360)
  // readonly: the object is memoized + aliased into every orb of this author;
  // mutating it would corrupt all of them.
  rgb: readonly [number, number, number]; // linear-light, 0..1 each
}

// Memoized by hue+lightness+chroma: a repo has far fewer distinct authors than
// commits/orbs, so this collapses ~one OKLCH conversion per orb to one per
// author. The returned object is shared — callers must treat it as read-only.
const _colorCache = new Map<string, AuthorColor>();
// Bound the memo so a long session across many repos can't grow it without
// limit (comfortably fits one huge repo's authors × 2 lightness variants).
// Clearing is safe — values are pure functions of the key.
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

/** Pastel variant of `colorForAuthor` — same hue, higher lightness, lower
 *  chroma. Used for the per-author orbit-ring hover highlight so each
 *  hovered orb's ring picks up its author's identity in a softer tone. */
export function lightColorForAuthor(hue: number): AuthorColor {
  return authorColorAt(hue, LIGHT_L, LIGHT_C);
}
