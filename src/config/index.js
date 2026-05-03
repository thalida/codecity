// config/index.js — barrel re-export for convenient bulk import.
//
// Each domain module (layout, scene, street, building, gem, camera,
// interaction, sidebar) owns its own configuration as nanostores `map()` /
// `atom()` stores. Consumers can import either from this barrel:
//
//   import { SIDEWALK_COLORS, BUILDING_FADE } from './config';
//
// or directly from the domain file (better for tree-shaking + locality):
//
//   import { SIDEWALK_COLORS } from './config/street.js';
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

export * from './layout.js';
export * from './scene.js';
export * from './street.js';
export * from './building.js';
export * from './gem.js';
export * from './camera.js';
export * from './interaction.js';
export * from './sidebar.js';
export * from './rendering.js';
export * from './ui.js';
export * from './formatting.js';
