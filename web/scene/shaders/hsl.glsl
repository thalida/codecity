// hsl.glsl — color-shading helpers ported from web/scene/hsl.ts.
// Math must match hsl.ts byte-for-byte (within float precision).
// Verified by web/tests/scene/hsl-glsl-parity.test.ts.
//
// NOTE: hsl.ts operates on HSL strings where l and s are percentages (0–100)
// and h is in degrees (0–360). This shader port works on the same domain but
// normalised to [0,1]: h/360, s/100, l/100. The three public functions accept
// RGB vec3 in [0,1] and return RGB vec3 in [0,1] so callers never touch HSL
// directly — the same interface the building shader will use.

// ---------------------------------------------------------------------------
// Internal HSL ↔ RGB conversion (GLSL ES 3.00)
// ---------------------------------------------------------------------------

vec3 _rgbToHsl(vec3 c) {
  float r = c.r, g = c.g, b = c.b;
  float maxc = max(r, max(g, b));
  float minc = min(r, min(g, b));
  float l = (maxc + minc) * 0.5;
  float d = maxc - minc;
  if (d < 0.0001) return vec3(0.0, 0.0, l);
  float s = l > 0.5 ? d / (2.0 - maxc - minc) : d / (maxc + minc);
  float h;
  if (maxc == r) h = ((g - b) / d) + (g < b ? 6.0 : 0.0);
  else if (maxc == g) h = ((b - r) / d) + 2.0;
  else h = ((r - g) / d) + 4.0;
  h /= 6.0;
  return vec3(h, s, l);
}

float _hue2rgb(float p, float q, float t) {
  if (t < 0.0) t += 1.0;
  if (t > 1.0) t -= 1.0;
  if (t < 1.0 / 6.0) return p + (q - p) * 6.0 * t;
  if (t < 0.5) return q;
  if (t < 2.0 / 3.0) return p + (q - p) * (2.0 / 3.0 - t) * 6.0;
  return p;
}

vec3 _hslToRgb(vec3 c) {
  float h = c.x, s = c.y, l = c.z;
  if (s < 0.0001) return vec3(l);
  float q = l < 0.5 ? l * (1.0 + s) : l + s - l * s;
  float p = 2.0 * l - q;
  return vec3(_hue2rgb(p, q, h + 1.0 / 3.0),
              _hue2rgb(p, q, h),
              _hue2rgb(p, q, h - 1.0 / 3.0));
}

// ---------------------------------------------------------------------------
// Public helpers — signatures mirror hsl.ts, arguments in GLSL-natural units.
//
//   deltaPct      — same unit as hsl.ts `amount`: lightness percentage points
//                   in the 0–100 domain (e.g. +10 brightens by 10 pp)
//   deltaHueDeg   — degrees (0–360 domain), same as hsl.ts `hueDelta`
//   ratio         — multiplicative factor, same as hsl.ts `ratio`
//   floorPct      — absolute lightness floor in the 0–100 domain,
//                   same as hsl.ts `floor`
//   minLightPct   — optional minimum lightness in the 0–100 domain,
//                   same as hsl.ts `minLightness`; pass -1.0 to mean "no floor"
// ---------------------------------------------------------------------------

// shadeColor(rgb, deltaPct) — adjust lightness by deltaPct percentage points.
// Matches: hsl.ts shadeColor(hslString, amount).
vec3 shadeColor(vec3 rgb, float deltaPct) {
  vec3 hsl = _rgbToHsl(rgb);
  hsl.z = clamp(hsl.z + deltaPct / 100.0, 0.0, 1.0);
  return _hslToRgb(hsl);
}

// shadeAndShiftHue(rgb, deltaLightPct, deltaHueDeg, minLightPct) —
// adjust lightness AND hue; minLightPct < 0.0 means no floor (maps to null).
// Matches: hsl.ts shadeAndShiftHue(hslString, lightnessDelta, hueDelta, minLightness?).
vec3 shadeAndShiftHue(vec3 rgb, float deltaLightPct, float deltaHueDeg, float minLightPct) {
  vec3 hsl = _rgbToHsl(rgb);
  // hue wrap: same as (((h_deg + hueDelta) % 360) + 360) % 360 in JS,
  // but h is already normalised to [0,1] so we work in that space.
  hsl.x = mod(hsl.x + deltaHueDeg / 360.0 + 1.0, 1.0);
  float floor01 = minLightPct < 0.0 ? 0.0 : minLightPct / 100.0;
  hsl.z = clamp(max(hsl.z + deltaLightPct / 100.0, floor01), 0.0, 1.0);
  return _hslToRgb(hsl);
}

// shadeByRatio(rgb, ratio, deltaHueDeg, floorPct) —
// lightness *= ratio; shift hue; clamp to >= floorPct.
// Matches: hsl.ts shadeByRatio(hslString, ratio, hueDelta, floor).
vec3 shadeByRatio(vec3 rgb, float ratio, float deltaHueDeg, float floorPct) {
  vec3 hsl = _rgbToHsl(rgb);
  hsl.x = mod(hsl.x + deltaHueDeg / 360.0 + 1.0, 1.0);
  float newL = hsl.z * ratio;
  hsl.z = clamp(max(newL, floorPct / 100.0), 0.0, 1.0);
  return _hslToRgb(hsl);
}
