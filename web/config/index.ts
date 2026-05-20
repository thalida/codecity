// config/index.ts — Barrel re-export. Each domain module owns its own
// nanostore(s) and exports them by name; this file just lets callers do a
// single bulk `import * as Config` for persistence wiring, or pull named
// imports for direct use.
//
// Reading values:
//   const sc = SIDEWALK_COLORS.get();   // → { DEFAULT, HOVER, SELECTED }
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

export * from './view.js'; // sky color, camera, input, tooltip
export * from './fly.js'; // fly-mode controls (WASD camera)
export * from './animation.js'; // shared transition timing (camera + building tweens)
export * from './street.js'; // asphalt, sidewalks, labels, path line, tiers, packing
export * from './building.js'; // dimensions, palette, outlines, fade
export * from './gem.js'; // root-of-repo landmark
export * from './effects.js'; // shared visual effects (rainbow)
export * from './lighting.js'; // scene directional lighting (sun + ambient)
export * from './facade.js'; // procedural facade geometry (slab/window/door/roof fracs)
export * from './adPanel.js'; // procedural ad-panel geometry (margin/offset/placeholder)
export * from './live.js'; // live-update polling toggle + interval
export * from './scan.js'; // scan-filter toggle (bypass tracked-files filter)
export * from './lod.js'; // per-block LOD swap thresholds
export * from './syntaxTheme.js'; // syntax highlight theme picker
export * from './sky.js'; // Cyberpunk Valley: procedural sky gradient + stars + moon
