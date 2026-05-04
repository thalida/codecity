// config/effects.js — Cross-cutting visual effects shared between multiple
// consumers. Keeping these in one place means tweaking the look (e.g. "make
// all rainbows slower") doesn't require chasing the same values through
// multiple per-target stores.

import { map } from 'nanostores';

// Chasing-rainbow effect used by BOTH the selected building's neon
// outline and the gem→selection neon path line. Both consumers cycle hue
// at SPEED rad/ms; SATURATION + LIGHTNESS set the palette intensity.
// Hot-reloadable; both consumers read fresh per frame.
export const RAINBOW = map({
  SPEED:      0.0005,    // hue cycles per millisecond
  SATURATION: 1.0,
  LIGHTNESS:  0.625
});
