// scene/fireflies/authorColor.ts — deterministic per-author color.
//
// FNV-1a hash of the UTF-8 bytes of the author name → hue in
// [0, 360). Fixed lightness/chroma so every author gets a bright,
// saturated mote color that reads against the dark sky.
//
// Used by both the commit pane (color dot next to the author name)
// and the fireflies renderer (per-instance orb color). Same input =
// same output across rebuilds and across consumers.

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
  rgb: [number, number, number]; // linear-light, 0..1 each
}

/** FNV-1a over UTF-8 bytes; returns an unsigned 32-bit int. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5 >>> 0;
  // TextEncoder hands us the UTF-8 bytes; that means unicode names hash
  // consistently regardless of how the JS string is encoded internally.
  const bytes = new TextEncoder().encode(s);
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** OKLCH → linear sRGB, 0..1 each. Standard formulas; no external dep. */
function oklchToLinearRgb(l: number, c: number, hueDeg: number): [number, number, number] {
  const h = (hueDeg * Math.PI) / 180;
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);

  // Inverse of OKLab → LMS: cube-root in forward; cube in inverse.
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;

  const lm = l_ * l_ * l_;
  const mm = m_ * m_ * m_;
  const sm = s_ * s_ * s_;

  // LMS → linear sRGB
  const r = +4.0767416621 * lm - 3.3077115913 * mm + 0.2309699292 * sm;
  const g = -1.2684380046 * lm + 2.6097574011 * mm - 0.3413193965 * sm;
  const b2 = -0.0041960863 * lm - 0.7034186147 * mm + 1.707614701 * sm;

  return [Math.max(0, Math.min(1, r)), Math.max(0, Math.min(1, g)), Math.max(0, Math.min(1, b2))];
}

/** Linear sRGB (0..1) → gamma-corrected sRGB → "#rrggbb". */
function linearRgbToHex([r, g, b]: [number, number, number]): string {
  const enc = (x: number): number => {
    const srgb = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
    return Math.round(Math.max(0, Math.min(1, srgb)) * 255);
  };
  const toHex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${toHex(enc(r))}${toHex(enc(g))}${toHex(enc(b))}`;
}

function authorColorAt(name: string, l: number, c: number): AuthorColor {
  const hash = fnv1a(name);
  const hue = hash % 360;
  const rgb = oklchToLinearRgb(l, c, hue);
  return { hex: linearRgbToHex(rgb), hue, rgb };
}

export function colorForAuthor(name: string): AuthorColor {
  return authorColorAt(name, ORB_L, ORB_C);
}

/** Pastel variant of `colorForAuthor` — same hue, higher lightness, lower
 *  chroma. Used for the per-author orbit-ring hover highlight so each
 *  hovered orb's ring picks up its author's identity in a softer tone. */
export function lightColorForAuthor(name: string): AuthorColor {
  return authorColorAt(name, LIGHT_L, LIGHT_C);
}
