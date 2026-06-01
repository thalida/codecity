// constants/streets.ts — Street designer constants that are NOT user-tunable.
//
// These shape geometry / texture internals and were never exposed as Settings
// controls, so they live here rather than in the STREETS settings store:
//   ASPHALT_WIDTH_FRAC      — asphalt stripe width as a fraction of street
//                             width; the sidewalk strip is the remainder. The
//                             concentric-cap math depends on it, so users must
//                             not be able to break it.
//   LABEL_FONT_FAMILY / _WEIGHT — road-label typeface; baked into the label
//                             texture, no visible effect to tune at zoom.
//   LABEL_ELEVATION         — lift of block labels above the roof (≈0).
//   PATH_LINE_ELEVATION     — Y of the selection path line above ground.
//   HOVER_PATH_LINE_ELEVATION — Y of the hover-preview line (just below the
//                             selection line so the rainbow stays on top).

export const ASPHALT_WIDTH_FRAC = 0.6;

export const LABEL_FONT_FAMILY = 'Inter, "SF Mono", sans-serif';
export const LABEL_FONT_WEIGHT = 700;
export const LABEL_ELEVATION = 0;

export const PATH_LINE_ELEVATION = 0.3;
export const HOVER_PATH_LINE_ELEVATION = 0.25;
