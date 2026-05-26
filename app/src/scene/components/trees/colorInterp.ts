// scene/trees/colorInterp.ts — perceptual color interpolation through
// OKLab/OKLCH so blends between distant hues (e.g. purple → teal)
// pass through a saturated midpoint instead of muddying into gray.
//
// All inputs/outputs are linear sRGB triplets in [0, 1]. The OKLab
// matrices are from Björn Ottosson's reference implementation:
// https://bottosson.github.io/posts/oklab/
//
// Why OKLCH and not OKLab linear:
//   - OKLab linear interpolation moves through the (a, b) plane in a
//     straight line — for hue-distant colors that line can pass
//     through low chroma (toward gray).
//   - OKLCH (polar form) interpolates Lightness, Chroma, and Hue
//     separately. Hue follows the shortest arc on the color wheel,
//     so the midpoint stays at the average chroma — saturated.

function linearToOklab(
  r: number,
  g: number,
  b: number,
  out: { L: number; a: number; b: number }
): void {
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const lc = Math.cbrt(l);
  const mc = Math.cbrt(m);
  const sc = Math.cbrt(s);
  out.L = 0.2104542553 * lc + 0.793617785 * mc - 0.0040720468 * sc;
  out.a = 1.9779984951 * lc - 2.428592205 * mc + 0.4505937099 * sc;
  out.b = 0.0259040371 * lc + 0.7827717662 * mc - 0.808675766 * sc;
}

function oklabToLinear(
  L: number,
  a: number,
  b: number,
  out: { r: number; g: number; b: number }
): void {
  const lc = L + 0.3963377774 * a + 0.2158037573 * b;
  const mc = L - 0.1055613458 * a - 0.0638541728 * b;
  const sc = L - 0.0894841775 * a - 1.291485548 * b;
  const l = lc * lc * lc;
  const m = mc * mc * mc;
  const s = sc * sc * sc;
  out.r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  out.g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  out.b = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
}

const _lab1 = { L: 0, a: 0, b: 0 };
const _lab2 = { L: 0, a: 0, b: 0 };
const _lin = { r: 0, g: 0, b: 0 };

const CHROMA_EPSILON = 1e-6;

export interface RgbLike {
  r: number;
  g: number;
  b: number;
}

/** Interpolate `c1` → `c2` at parameter `t` through OKLCH, writing
 *  the linear-sRGB result into `out`. The midpoint preserves chroma
 *  by interpolating hue along the shortest arc; lightness and
 *  chroma interpolate linearly between the two endpoints.
 *
 *  Out-of-gamut results (rare for moderate chroma but possible on
 *  highly saturated paths) are clamped to [0, 1] per channel. */
export function interpolateOklch(c1: RgbLike, c2: RgbLike, t: number, out: RgbLike): void {
  linearToOklab(c1.r, c1.g, c1.b, _lab1);
  linearToOklab(c2.r, c2.g, c2.b, _lab2);

  const C1 = Math.hypot(_lab1.a, _lab1.b);
  const C2 = Math.hypot(_lab2.a, _lab2.b);

  // Gray endpoints have an undefined hue; adopt the other endpoint's
  // hue so the path stays straight through the gray color instead of
  // pivoting arbitrarily through the red axis.
  let h1: number;
  let h2: number;
  if (C1 < CHROMA_EPSILON && C2 < CHROMA_EPSILON) {
    h1 = h2 = 0;
  } else if (C1 < CHROMA_EPSILON) {
    h1 = h2 = Math.atan2(_lab2.b, _lab2.a);
  } else if (C2 < CHROMA_EPSILON) {
    h1 = h2 = Math.atan2(_lab1.b, _lab1.a);
  } else {
    h1 = Math.atan2(_lab1.b, _lab1.a);
    h2 = Math.atan2(_lab2.b, _lab2.a);
  }

  // Shortest hue arc (wrap dh into [-π, π]).
  let dh = h2 - h1;
  if (dh > Math.PI) dh -= 2 * Math.PI;
  if (dh < -Math.PI) dh += 2 * Math.PI;

  const L = _lab1.L + (_lab2.L - _lab1.L) * t;
  const C = C1 + (C2 - C1) * t;
  const h = h1 + dh * t;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);

  oklabToLinear(L, a, b, _lin);
  out.r = _lin.r < 0 ? 0 : _lin.r > 1 ? 1 : _lin.r;
  out.g = _lin.g < 0 ? 0 : _lin.g > 1 ? 1 : _lin.g;
  out.b = _lin.b < 0 ? 0 : _lin.b > 1 ? 1 : _lin.b;
}
