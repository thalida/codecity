// hsl.glsl has no runnable twin: vitest has no GPU, and a JS reimplementation
// would only ever prove itself. Pinning the operative lines is what is left, so
// an edited formula has to break something. It cannot catch a compile error.
// The TS side is covered directly by utils/color/hsl.test.ts.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const SRC = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../../src/utils/shaders/hsl.glsl'),
  'utf-8'
);

const HELPERS = [
  {
    name: 'shadeColor',
    signature: 'vec3 shadeColor(vec3 rgb, float deltaPct)',
    body: ['hsl.z = clamp(hsl.z + deltaPct / 100.0, 0.0, 1.0);'],
  },
  {
    name: 'shadeAndShiftHue',
    signature:
      'vec3 shadeAndShiftHue(vec3 rgb, float deltaLightPct, float deltaHueDeg, float minLightPct)',
    body: [
      'hsl.x = mod(hsl.x + deltaHueDeg / 360.0 + 1.0, 1.0);',
      'float floor01 = minLightPct < 0.0 ? 0.0 : minLightPct / 100.0;',
      'hsl.z = clamp(max(hsl.z + deltaLightPct / 100.0, floor01), 0.0, 1.0);',
    ],
  },
  {
    name: 'shadeByRatio',
    // No upper clamp: hsl.ts has none either, and building.frag.glsl relies on
    // the two agreeing for the outline colour.
    signature: 'vec3 shadeByRatio(vec3 rgb, float ratio, float deltaHueDeg, float floorPct)',
    body: ['float newL = hsl.z * ratio;', 'hsl.z = max(newL, floorPct / 100.0);'],
  },
];

describe('hsl.glsl', () => {
  it.each(HELPERS)('$name keeps its signature and its formula', (helper) => {
    expect(SRC).toContain(helper.signature);
    for (const line of helper.body) expect(SRC).toContain(line);
  });
});
