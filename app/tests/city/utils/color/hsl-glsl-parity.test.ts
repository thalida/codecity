// hsl-glsl-parity.test.ts
//
// Verifies that the GLSL helpers in hsl.glsl produce results that match the
// JS helpers in hsl.ts, within float-precision tolerance.
//
// Strategy (the "JS twin" approach):
//   1. Confirm the GLSL source file exists and declares the right signatures.
//   2. Implement JS twins of the GLSL functions that operate on [r,g,b] tuples
//      in [0,1], mirroring the GLSL math step-by-step.
//   3. For each test case: call the JS (hsl.ts) helper, call the JS twin, and
//      assert the HSL components they produce agree within tolerance.
//      (Rather than hex rounding, we compare HSL components directly so that
//      small per-channel differences don't get amplified by 8-bit quantisation.)

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  shadeColor,
  shadeAndShiftHue,
  shadeByRatio,
  hslToComponents,
} from '@/city/utils/color/colors';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// JS twin of the GLSL helpers
// Operates on RGB tuples [0..1] matching hsl.glsl math step-by-step.
// ---------------------------------------------------------------------------

type RGB = [number, number, number];
type HSL = [number, number, number]; // h,s,l all in [0,1]

function _rgbToHsl([r, g, b]: RGB): HSL {
  const maxc = Math.max(r, g, b);
  const minc = Math.min(r, g, b);
  const l = (maxc + minc) * 0.5;
  const d = maxc - minc;
  if (d < 0.0001) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - maxc - minc) : d / (maxc + minc);
  let h: number;
  if (maxc === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (maxc === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

function _hue2rgb(p: number, q: number, t: number): number {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 0.5) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

function _hslToRgb([h, s, l]: HSL): RGB {
  if (s < 0.0001) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [_hue2rgb(p, q, h + 1 / 3), _hue2rgb(p, q, h), _hue2rgb(p, q, h - 1 / 3)];
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

// Twin of GLSL shadeColor(rgb, deltaPct)
function twinShadeColor(rgb: RGB, deltaPct: number): RGB {
  const hsl = _rgbToHsl(rgb);
  hsl[2] = clamp01(hsl[2] + deltaPct / 100);
  return _hslToRgb(hsl);
}

// Twin of GLSL shadeAndShiftHue(rgb, deltaLightPct, deltaHueDeg, minLightPct)
// Pass minLightPct < 0 to mean "no floor" (same as null in JS).
function twinShadeAndShiftHue(
  rgb: RGB,
  deltaLightPct: number,
  deltaHueDeg: number,
  minLightPct: number
): RGB {
  const hsl = _rgbToHsl(rgb);
  hsl[0] = (((hsl[0] + deltaHueDeg / 360 + 1) % 1) + 1) % 1; // extra +1/%1 for negative shifts
  const floor01 = minLightPct < 0 ? 0 : minLightPct / 100;
  hsl[2] = clamp01(Math.max(hsl[2] + deltaLightPct / 100, floor01));
  return _hslToRgb(hsl);
}

// Twin of GLSL shadeByRatio(rgb, ratio, deltaHueDeg, floorPct)
// No upper clamp — mirrors both hsl.ts (Math.max(floor, l*ratio)) and the
// updated GLSL (which also omits the upper clamp for byte-for-byte parity).
// Production callers always pass ratio<1, so l never exceeds 1.0 in practice.
function twinShadeByRatio(rgb: RGB, ratio: number, deltaHueDeg: number, floorPct: number): RGB {
  const hsl = _rgbToHsl(rgb);
  hsl[0] = (((hsl[0] + deltaHueDeg / 360 + 1) % 1) + 1) % 1;
  const newL = hsl[2] * ratio;
  hsl[2] = Math.max(newL, floorPct / 100);
  return _hslToRgb(hsl);
}

// ---------------------------------------------------------------------------
// Conversion helpers between the two worlds
// ---------------------------------------------------------------------------

// HSL string (hsl.ts output) → [h_deg, s_pct, l_pct]
function hslStrToComponents(hslStr: string): [number, number, number] {
  const c = hslToComponents(hslStr);
  return [c.h, c.s, c.l];
}

// RGB [0,1] → HSL percentages/degrees via the JS twin's internal conversion,
// then scale back out: h*360, s*100, l*100.
function rgbToHslDeg(rgb: RGB): [number, number, number] {
  const [h, s, l] = _rgbToHsl(rgb);
  return [h * 360, s * 100, l * 100];
}

// HSL percentages [h_deg, s_pct, l_pct] → RGB [0,1]
function hslDegToRgb(h: number, s: number, l: number): RGB {
  return _hslToRgb([h / 360, s / 100, l / 100]);
}

// ---------------------------------------------------------------------------
// Test fixtures — a battery of representative HSL inputs.
// The format is [h_deg, s_pct, l_pct] to stay in hsl.ts's natural units.
// Includes: saturated primaries, pastels, near-black, near-white, greys,
//           hue-edge cases near 0/360.
// ---------------------------------------------------------------------------

const HSL_SAMPLES: Array<[number, number, number]> = [
  [0, 80, 50], // red
  [120, 80, 50], // green
  [240, 80, 50], // blue
  [60, 70, 60], // yellow-ish
  [180, 60, 45], // cyan-ish
  [300, 70, 55], // magenta-ish
  [215, 80, 55], // representative app blue
  [30, 50, 35], // dim brownish (old file)
  [200, 50, 15], // very dark
  [200, 50, 85], // very light
  [0, 0, 50], // grey (achromatic)
  [0, 0, 0], // black
  [0, 0, 100], // white
  [350, 60, 50], // near-0 hue (wrapping tests)
  [5, 60, 50], // just above 0 hue
];

function hslSampleToString(h: number, s: number, l: number): string {
  return `hsl(${h}, ${s}%, ${l}%)`;
}

// Tolerance for comparing HSL components:
//   Hue: within 0.6° (round-trip through float HSL can shift by a fraction of a degree)
//   Saturation / Lightness: within 0.1 pp
//
// We use 0.1 pp (not 0.05) because hsl.ts formats lightness with toFixed(1),
// which introduces up to 0.05 rounding error when the value falls exactly at
// a .05 boundary (e.g. 19.25 → "19.3"). The GLSL twin operates in float and
// has no such rounding, so the difference can be exactly 0.05 pp — just at
// the edge of a toBeCloseTo(x,1) assertion. 0.1 pp is still well within any
// visually meaningful tolerance.
const HUE_TOL = 0.6;
const SL_TOL = 0.1;

function expectHslClose(
  label: string,
  actual: [number, number, number], // [h_deg, s_pct, l_pct] from hsl.ts
  twin: RGB // RGB from GLSL twin
): void {
  const twinHsl = rgbToHslDeg(twin);
  // When lightness is at or near 0 or 100 (grey/black/white), hue and
  // saturation are degenerate — only compare lightness in those cases.
  const isAchromatic = actual[2] < 0.5 || actual[2] > 99.5 || actual[1] < 0.5;
  if (!isAchromatic) {
    // Handle wrap-around: treat 0° and 360° as the same
    const hueDiff = Math.min(
      Math.abs(twinHsl[0] - actual[0]),
      360 - Math.abs(twinHsl[0] - actual[0])
    );
    expect(hueDiff, `${label} — hue diff`).toBeLessThanOrEqual(HUE_TOL);
    // Saturation is also degenerate when lightness is at boundary
    expect(Math.abs(twinHsl[1] - actual[1]), `${label} — saturation diff`).toBeLessThanOrEqual(
      SL_TOL
    );
  }
  expect(Math.abs(twinHsl[2] - actual[2]), `${label} — lightness diff`).toBeLessThanOrEqual(SL_TOL);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('hsl.glsl parity with hsl.ts', () => {
  it('GLSL source file exists and declares all three public helpers', () => {
    const src = readFileSync(
      resolve(__dirname, '../../../../src/city/utils/shaders/hsl.glsl'),
      'utf-8'
    );
    expect(src).toContain('vec3 shadeColor(vec3 rgb, float deltaPct)');
    expect(src).toContain(
      'vec3 shadeAndShiftHue(vec3 rgb, float deltaLightPct, float deltaHueDeg, float minLightPct)'
    );
    expect(src).toContain(
      'vec3 shadeByRatio(vec3 rgb, float ratio, float deltaHueDeg, float floorPct)'
    );
  });

  describe('shadeColor parity', () => {
    const deltas = [-30, -10, 0, 10, 25, 50, -5];

    for (const [h, s, l] of HSL_SAMPLES) {
      for (const delta of deltas) {
        it(`shadeColor hsl(${h}, ${s}%, ${l}%) delta=${delta}`, () => {
          const hslStr = hslSampleToString(h, s, l);
          // JS side: returns an HSL string
          const jsOut = shadeColor(hslStr, delta);
          const jsHsl = hslStrToComponents(jsOut);

          // GLSL twin side: operates on RGB
          const rgb = hslDegToRgb(h, s, l);
          const twinOut = twinShadeColor(rgb, delta);

          expectHslClose(`shadeColor(${hslStr}, ${delta})`, jsHsl, twinOut);
        });
      }
    }
  });

  describe('shadeAndShiftHue parity', () => {
    const lightDeltas = [-30, -10, 0, 10, 25];
    const hueDeltas = [-30, 0, 18, 90, -180];
    // Use a representative subset to keep test count manageable
    const samples = HSL_SAMPLES.slice(0, 8);

    for (const [h, s, l] of samples) {
      for (const dl of lightDeltas) {
        for (const dh of hueDeltas) {
          it(`shadeAndShiftHue hsl(${h}, ${s}%, ${l}%) dl=${dl} dh=${dh}`, () => {
            const hslStr = hslSampleToString(h, s, l);
            // JS: shadeAndShiftHue(hslString, lightnessDelta, hueDelta, minLightness?)
            // Pass undefined for minLightness (no floor) → same as minLightPct = -1 in GLSL
            const jsOut = shadeAndShiftHue(hslStr, dl, dh, undefined);
            const jsHsl = hslStrToComponents(jsOut);

            const rgb = hslDegToRgb(h, s, l);
            const twinOut = twinShadeAndShiftHue(rgb, dl, dh, -1);

            expectHslClose(`shadeAndShiftHue(${hslStr}, ${dl}, ${dh})`, jsHsl, twinOut);
          });

          // Also test with a minLightness floor
          it(`shadeAndShiftHue hsl(${h}, ${s}%, ${l}%) dl=${dl} dh=${dh} floor=10`, () => {
            const hslStr = hslSampleToString(h, s, l);
            const jsOut = shadeAndShiftHue(hslStr, dl, dh, 10);
            const jsHsl = hslStrToComponents(jsOut);

            const rgb = hslDegToRgb(h, s, l);
            const twinOut = twinShadeAndShiftHue(rgb, dl, dh, 10);

            expectHslClose(`shadeAndShiftHue(${hslStr}, ${dl}, ${dh}, 10)`, jsHsl, twinOut);
          });
        }
      }
    }
  });

  describe('shadeByRatio parity', () => {
    const ratios = [0.1, 0.4, 0.55, 1.0, 1.5];
    const hueDeltas = [-18, 0, 18];
    const floors = [0, 10, 14];
    // Include high-lightness samples (indices 8+ cover l=15, l=85, greys,
    // black, white) so that ratio=1.5 with l=85 exercises the previously
    // divergent path: l*ratio = 127.5% > 100%.  Both GLSL and JS now agree
    // by omitting the upper clamp (JS never had one; GLSL's clamp is removed).
    const samples = HSL_SAMPLES;

    for (const [h, s, l] of samples) {
      for (const ratio of ratios) {
        for (const dh of hueDeltas) {
          for (const floor of floors) {
            it(`shadeByRatio hsl(${h}, ${s}%, ${l}%) ratio=${ratio} dh=${dh} floor=${floor}`, () => {
              const hslStr = hslSampleToString(h, s, l);
              // JS: shadeByRatio(hslString, ratio, hueDelta, floor)
              const jsOut = shadeByRatio(hslStr, ratio, dh, floor);
              const jsHsl = hslStrToComponents(jsOut);

              const rgb = hslDegToRgb(h, s, l);
              const twinOut = twinShadeByRatio(rgb, ratio, dh, floor);

              expectHslClose(`shadeByRatio(${hslStr}, ${ratio}, ${dh}, ${floor})`, jsHsl, twinOut);
            });
          }
        }
      }
    }
  });
});
