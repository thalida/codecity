// config/index.js — Barrel re-export. Each domain module owns its own
// nanostore(s) and exports them by name; this file just lets callers do a
// single bulk `import * as Config` for persistence wiring, or pull named
// imports for direct use.
//
// Reading values:
//   const sc = SIDEWALK_COLORS.get();   // → { DEFAULT, HOVER, SELECTED, PATH }
//   sc.HOVER                            // → '#d0d2da'
//
// Mutating (Settings UI / tests):
//   SIDEWALK_COLORS.setKey('HOVER', '#ff0080');
//
// Reacting:
//   import { listenKeys } from 'nanostores';
//   listenKeys(SIDEWALK_COLORS, ['HOVER'], state => { ... });
//   SIDEWALK_COLORS.subscribe(state => { ... });   // any change
//
// Implementation constants that aren't user-tunable (RENDER_ORDERS, sightline
// raycast epsilons, facade-texture pixel math, lucide-icon CDN URL, activity-
// bar tab list, etc.) live OUTSIDE this barrel — see src/constants.js or
// inlined private consts in their consumer module.

export * from './view.js';        // sky color, camera, input, tooltip
export * from './street.js';      // asphalt, sidewalks, labels, path line, tiers, packing
export * from './building.js';    // dimensions, palette, outlines, fade
export * from './gem.js';         // root-of-repo landmark
export * from './effects.js';     // shared visual effects (rainbow)
