// city/utils/color/colors.ts — Pure color-math helpers. No Three.js, no DOM. Unit-testable
// in jsdom.
//
// Three color spaces live here. Pick the right one for the job:
//
//   HSL (hue, saturation %, lightness %) — what the existing building
//     palette + shader work in. Cheap, ubiquitous, but PERCEPTUALLY UNEVEN
//     (yellow looks much brighter than blue at the same lightness). The
//     `shade*` helpers in this file mirror the equivalent functions in
//     `hsl.glsl` exactly — that pairing is checked by hsl-glsl-parity.test.ts.
//
//   OKLab (L, a, b) — perceptually uniform Cartesian space. Best when
//     INTERPOLATING between two arbitrary colors (e.g. building-color
//     ramps for solo-day vs busy-day commits): straight-line motion in
//     OKLab corresponds to perceptually straight transitions, so the
//     midpoint doesn't muddy to gray the way RGB or HSL midpoints do.
//
//   OKLCH (L, C, h) — perceptually uniform Polar form. Same lightness
//     ramp as OKLab but with explicit hue and chroma. Best when
//     GENERATING a palette at fixed (L, C) across evenly-spaced hues
//     (e.g. the gem face rainbow) — every step looks like an equal
//     hue jump because the perceptual lightness stays constant.
//
// OKLab math comes from Björn Ottosson's reference (oklab.org). The
// sRGB encoding step is the standard piecewise gamma curve.

// ── HSL helpers (CSS-string-based; mirror hsl.glsl) ───────────────────────

export interface HslComponents {
  h: number;
  s: number;
  l: number;
}

export function hslToComponents(hslString: string): HslComponents {
  const inner = hslString.replace(/^hsl\(/i, '').replace(/\)$/, '');
  const parts = inner.split(',');
  return {
    h: parseFloat(parts[0].trim()),
    s: parseFloat(parts[1].trim()),
    l: parseFloat(parts[2].trim()),
  };
}

export function componentsToHsl(h: number, s: number, l: number): string {
  return `hsl(${Math.round(h)}, ${s.toFixed(1)}%, ${l.toFixed(1)}%)`;
}

export function shadeColor(hslString: string, amount: number): string {
  const c = hslToComponents(hslString);
  const newL = Math.max(0, Math.min(100, c.l + amount));
  return componentsToHsl(c.h, c.s, newL);
}

export function shadeAndShiftHue(
  hslString: string,
  lightnessDelta: number,
  hueDelta: number,
  minLightness?: number
): string {
  const c = hslToComponents(hslString);
  const floor = minLightness != null ? minLightness : 0;
  const newL = Math.max(floor, Math.min(100, c.l + lightnessDelta));
  const newH = (((c.h + hueDelta) % 360) + 360) % 360;
  return componentsToHsl(newH, c.s, newL);
}

// Multiplicative darkening with an absolute floor. Used for side walls so that
// contrast against the front face scales with the base lightness — dim files
// still get visibly darker sides without crushing to black.
export function shadeByRatio(
  hslString: string,
  ratio: number,
  hueDelta: number,
  floor: number
): string {
  const c = hslToComponents(hslString);
  const newL = Math.max(floor, c.l * ratio);
  const newH = (((c.h + hueDelta) % 360) + 360) % 360;
  return componentsToHsl(newH, c.s, newL);
}

// ── OKLab / OKLCH conversion primitives ───────────────────────────────────

/** Linear sRGB → OKLab (Cartesian). Out-parameter for allocation-free use
 *  in per-frame / per-instance hot paths (e.g. treeRenderer color ramps). */
export function linearToOklab(
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

/** OKLab (Cartesian) → linear sRGB. Out-parameter; result is NOT clamped
 *  to [0, 1] — out-of-gamut highly-saturated OKLab triplets can produce
 *  negative or >1 channels and the caller decides what to do. */
export function oklabToLinear(
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

const _oklchScratch = { r: 0, g: 0, b: 0 };

/** OKLCH (polar) → linear sRGB, each channel clamped to [0, 1]. Allocates
 *  a fresh 3-tuple per call — fine for palette generation (called once
 *  at module load) but not for per-frame hot paths. */
export function oklchToLinearRgb(l: number, c: number, hueDeg: number): [number, number, number] {
  const h = (hueDeg * Math.PI) / 180;
  oklabToLinear(l, c * Math.cos(h), c * Math.sin(h), _oklchScratch);
  return [
    Math.max(0, Math.min(1, _oklchScratch.r)),
    Math.max(0, Math.min(1, _oklchScratch.g)),
    Math.max(0, Math.min(1, _oklchScratch.b)),
  ];
}

// ── Encoding (linear sRGB → hex) ──────────────────────────────────────────

/** Linear sRGB (0..1) → gamma-corrected sRGB → "#rrggbb". */
export function linearRgbToHex([r, g, b]: [number, number, number]): string {
  const enc = (x: number): number => {
    const srgb = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
    return Math.round(Math.max(0, Math.min(1, srgb)) * 255);
  };
  const toHex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${toHex(enc(r))}${toHex(enc(g))}${toHex(enc(b))}`;
}

/** OKLCH → "#rrggbb". Convenience for palette generators that don't need
 *  the intermediate linear-RGB tuple. */
export function oklchToHex(l: number, c: number, hueDeg: number): string {
  return linearRgbToHex(oklchToLinearRgb(l, c, hueDeg));
}

// ── Perceptual interpolation ──────────────────────────────────────────────

const _lab1 = { L: 0, a: 0, b: 0 };
const _lab2 = { L: 0, a: 0, b: 0 };
const _lin = { r: 0, g: 0, b: 0 };
const CHROMA_EPSILON = 1e-6;

export interface RgbLike {
  r: number;
  g: number;
  b: number;
}

/** Interpolate `c1` → `c2` at parameter `t` through OKLCH, writing the
 *  linear-sRGB result into `out`. Hue follows the shortest arc on the
 *  color wheel and chroma interpolates linearly, so the midpoint stays
 *  saturated instead of muddying through gray (the way OKLab linear or
 *  RGB linear interpolation would).
 *
 *  Gray endpoints (chroma below CHROMA_EPSILON) have an undefined hue;
 *  the path adopts the other endpoint's hue so it stays straight
 *  through the gray, not pivoting through red.
 *
 *  Out-of-gamut results (rare for moderate chroma but possible on
 *  highly saturated paths) are clamped to [0, 1] per channel. */
export function interpolateOklch(c1: RgbLike, c2: RgbLike, t: number, out: RgbLike): void {
  linearToOklab(c1.r, c1.g, c1.b, _lab1);
  linearToOklab(c2.r, c2.g, c2.b, _lab2);

  const C1 = Math.hypot(_lab1.a, _lab1.b);
  const C2 = Math.hypot(_lab2.a, _lab2.b);

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
