// config/sidebar.js — File-tree sidebar UI. The badge HSL params control
// the color chips next to each file in the tree.

import { map } from 'nanostores';

// Each badge color uses three HSL components keyed off the file's hue:
//   BG_SATURATION, BG_LIGHTNESS         — chip background
//   TEXT_SATURATION, TEXT_LIGHTNESS     — chip text
//   BORDER_SATURATION, BORDER_LIGHTNESS — chip border
export const SIDEBAR_BADGE = map({
  BG_SATURATION:       60,
  BG_LIGHTNESS:        40,
  TEXT_SATURATION:     20,
  TEXT_LIGHTNESS:      90,
  BORDER_SATURATION:   60,
  BORDER_LIGHTNESS:    50
});
