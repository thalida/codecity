// Shared typography fixture for atlas + cell label tests.
//
// This is intentionally a *test* fixture (small 64px font, simple colors)
// rather than the production LABEL_TYPOGRAPHY map from
// `src/config/components/streets.ts` — keeping the canvas tiny keeps the
// atlas-page tests cheap and deterministic.
//
// ELEVATION is the only field that differs between the two suites:
//   - atlas tests don't care about Y position (no scene attached), so 0.
//   - cell tests place a mesh in the world and assert on Y, so 0.5.
// Each suite spreads this and overrides ELEVATION as needed.

import type { LabelTypographyConfig } from '@/state/settings/index';

export const TYPOGRAPHY: LabelTypographyConfig = {
  FONT_FAMILY: 'sans-serif',
  FONT_WEIGHT: 700,
  FILL: '#fff',
  STROKE: '#000',
  STROKE_WIDTH_FRAC: 4 / 64,
  HEIGHT_FRAC: 0.45,
  ELEVATION: 0,
};
