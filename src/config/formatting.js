// config/formatting.js — Number / byte / date display formatting knobs.

import { map, atom } from 'nanostores';

// Byte thresholds for human-readable file size formatting.
//   < KB_THRESHOLD            → "N B"
//   < MB_THRESHOLD            → "N.N KB"
//   ≥ MB_THRESHOLD            → "N.N MB"
export const BYTE_FORMATTING = map({
  KB_THRESHOLD: 1024,
  MB_THRESHOLD: 1048576
});

// Intl.DateTimeFormat options for displayed dates in the file sidebar.
export const DATE_FORMAT_OPTIONS = atom({
  year:  'numeric',
  month: 'short',
  day:   'numeric'
});

// Theme-panel readout formatting — controls how slider values render in
// the Settings UI.
export const NUMBER_READOUT = map({
  LARGE_THRESHOLD: 10,    // ≥ this → integer formatting
  MID_THRESHOLD:   1,     // ≥ this → 2 decimal places
  // (below MID_THRESHOLD also gets 2 decimal places — kept for symmetry)
  DECIMAL_PLACES_LARGE: 0,
  DECIMAL_PLACES_MID:   2,
  DECIMAL_PLACES_SMALL: 2
});
