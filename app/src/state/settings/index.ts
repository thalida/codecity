// state/settings/index.ts — Single source of truth for every user-tunable atom.
//
// Configs are grouped on disk by where they're consumed, with file
// names mirroring the consumer:
//   config/system/      ↔ scene/system/  (camera, input, animator,
//                                          tooltip)
//   config/components/  ↔ scene/components/  (one file per component)
//   config/effects/     ↔ scene/effects/  (cross-cutting effect tunables)
//   config/world/       — world sizing + scene background
//   config/prefs/       — app-level user preferences (polling, scan,
//                          theme); not tied to a single consumer
//
// Component renderers (scene/components/*) import from these stores
// rather than owning their own config. The Settings UI
// (views/panes/controlsPane.ts) also reads + mutates through the same
// stores, with the optional draft layer in state/configDrafts.ts
// staging edits before commit.
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
// Implementation constants that aren't user-tunable (RENDER_ORDERS,
// sightline raycast epsilons, facade-texture pixel math, lucide-icon
// CDN URL, activity-bar tab list, etc.) live OUTSIDE this barrel —
// see src/constants/ or inlined private consts in their consumer.

// ── System (camera, input, animation, tooltip) ───────────────────────
export * from './system/cameraRig';
export * from './system/animator';
export * from './system/inputHandlers';
export * from './system/tooltip';

// ── App-level user preferences ────────────────────────────────────────
export * from './prefs/liveUpdates';
export * from './prefs/syntaxTheme';

// ── World (background + sizing) ───────────────────────────────────────
export * from './world/world';

// ── Visual components ─────────────────────────────────────────────────
export * from './components/sky';
export * from './components/lighting';
export * from './components/streets';
export * from './components/buildings';
export * from './components/facade';
export * from './components/adPanels';
export * from './components/gem';
export * from './components/island';
export * from './components/footprint';
export * from './components/trees';
export * from './components/fireflies';
export * from './components/repoLabel';

// ── Cross-cutting visual effects ──────────────────────────────────────
export * from './effects/effects';
