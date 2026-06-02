// Shared typography fixture for atlas + cell label tests.
//
// This is intentionally a *test* fixture (small simple colors) rather than the
// production STREETS label fields — keeping it local keeps the atlas-page
// tests cheap and deterministic. It matches buildLabelAtlas's LabelTypography
// param (typeface + ink only; placement like elevation is not the atlas's job).

import type { LabelTypography } from '@/city/components/labels/labelAtlas';

export const TYPOGRAPHY: LabelTypography = {
  FONT_FAMILY: 'sans-serif',
  FONT_WEIGHT: 700,
  FILL: '#fff',
  STROKE: '#000',
  STROKE_WIDTH_FRAC: 4 / 64,
};
