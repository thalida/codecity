// config/gem.js — Root-of-repo gem: sizing (rebuild-required), face palette
// (hot-reloadable via vertex color buffer rewrite), edge color (hot-reloadable),
// and animation tuning (hot-reloadable, read fresh per frame).

import { map, atom } from 'nanostores';

// ─── Sizing + landing zone ────────────────────────────────────────────────
// Layout reserves dead space around the gem based on these — changing any
// requires a re-layout.
export const GEM_SIZING = map({
  RADIUS_AS_STREET_FRAC: 0.35,     // gem radius = root street width × this
  MIN_RADIUS:            5,        // floor for narrow root streets
  HOVER_LIFT_FRAC:       0.3,      // gem hovers above road = radius × this
  BUILDING_CLEARANCE:    20        // dead-space pad past the gem
});

// ─── Face palette ──────────────────────────────────────────────────────────
// 8 vivid faces in a prismatic palette, spaced around the color wheel so
// no face blends with nearby building colors. Each entry is [r, g, b] in
// 0–1 range. Hot-reloadable.
export const GEM_FACE_PALETTE = atom([
  [1.00, 0.20, 0.55],   // hot pink
  [0.15, 0.90, 1.00],   // cyan
  [0.75, 1.00, 0.20],   // chartreuse
  [0.60, 0.25, 1.00],   // violet
  [1.00, 0.55, 0.10],   // orange
  [1.00, 0.20, 0.90],   // magenta
  [0.15, 1.00, 0.75],   // aqua
  [0.40, 1.00, 0.30]    // lime
]);

// ─── Edge color ────────────────────────────────────────────────────────────
// Neutral separator line drawn around the gem's faces. Hot-reloadable.
export const GEM_EDGE_COLOR = atom('#f0f0ff');

// ─── Body opacity ──────────────────────────────────────────────────────────
// The gem mesh renders semi-transparent so the colored faces have a
// jewel-like quality (fully opaque feels like a plastic toy). Hot-reloadable.
export const GEM_BODY_OPACITY = atom(0.9);

// ─── Animation ─────────────────────────────────────────────────────────────
// Read fresh each frame in the render loop, so changes apply immediately.
export const GEM_ANIMATION = map({
  ROTATION_SPEED:     0.6,         // radians/sec multiplier
  BOB_FREQUENCY:      1.8,         // bob cycles/sec multiplier
  BOB_AMPLITUDE_FRAC: 0.5,         // vertical bob distance = radius × this
  HOVER_SCALE:        1.25,        // gem grows by this factor on hover
  SCALE_LERP_SPEED:   0.18         // per-frame ease toward HOVER_SCALE
});
