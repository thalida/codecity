// config/gem.js — Root-of-repo gem: sizing (rebuild-required), face palette
// (hot-reloadable via vertex color buffer rewrite), edge color (hot-reloadable),
// and animation tuning (hot-reloadable, read fresh per frame).

import { map, atom } from 'nanostores';
// (atom kept for GEM_FACE_PALETTE — the others moved into the GEM_APPEARANCE
// map below.)

// ─── Sizing + landing zone ────────────────────────────────────────────────
// Layout reserves dead space around the gem based on these — changing any
// requires a re-layout.
export interface GemSizingConfig {
  RADIUS_AS_STREET_FRAC: number;
  MIN_RADIUS: number;
  HOVER_LIFT_FRAC: number;
  CLEARANCE_AS_GEM_WIDTH_FRAC: number;
}

export const GEM_SIZING = map<GemSizingConfig>({
  RADIUS_AS_STREET_FRAC: 0.5, // gem radius = root street width × this
  MIN_RADIUS: 8, // floor for narrow root streets
  HOVER_LIFT_FRAC: 0.5, // gem hovers above road = radius × this
  // Dead-space pad past the gem at the root street's origin end,
  // expressed as a multiple of the gem's diameter so the plaza always
  // scales with the gem rather than living in absolute world units.
  CLEARANCE_AS_GEM_WIDTH_FRAC: 1.0,
});

// ─── Face palette ──────────────────────────────────────────────────────────
// 8 vivid faces in a prismatic palette, spaced around the color wheel so
// no face blends with nearby building colors. Each entry is [r, g, b] in
// 0–1 range. Hot-reloadable.
/** RGB triple in 0–1 range. */
export type RgbTriple = [number, number, number];

export const GEM_FACE_PALETTE = atom<RgbTriple[]>([
  [1.0, 0.2, 0.55], // hot pink
  [0.15, 0.9, 1.0], // cyan
  [0.75, 1.0, 0.2], // chartreuse
  [0.6, 0.25, 1.0], // violet
  [1.0, 0.55, 0.1], // orange
  [1.0, 0.2, 0.9], // magenta
  [0.15, 1.0, 0.75], // aqua
  [0.4, 1.0, 0.3], // lime
]);

// ─── Appearance ────────────────────────────────────────────────────────────
// Edge color = neutral separator line drawn around the faces. Body opacity
// keeps the gem semi-transparent so the colored faces have a jewel-like
// quality (fully opaque feels like a plastic toy). Both hot-reloadable.
export interface GemAppearanceConfig {
  EDGE_COLOR: string;
  BODY_OPACITY: number;
}

export const GEM_APPEARANCE = map<GemAppearanceConfig>({
  EDGE_COLOR: '#7a7fff',
  BODY_OPACITY: 0.75,
});

// ─── Glow halo ─────────────────────────────────────────────────────────────
// Two billboarded sprite layers behind the gem, each painted with a
// soft radial-gradient alpha and additively blended. Sizes are
// multiples of the gem radius so the halo scales with the gem itself.
// All live/hot-reloadable.
export interface GemGlowConfig {
  ENABLED: boolean;
  INNER_SCALE: number;
  OUTER_SCALE: number;
  INNER_OPACITY: number;
  OUTER_OPACITY: number;
  ANIMATE_COLORS: boolean;
  CYCLE_PERIOD_SECONDS: number;
}

export const GEM_GLOW = map<GemGlowConfig>({
  ENABLED: true,
  INNER_SCALE: 4.0, // hot core, hugging the gem
  OUTER_SCALE: 15.0, // atmospheric falloff, large soft disk
  INNER_OPACITY: 0.75,
  OUTER_OPACITY: 0.5,
  ANIMATE_COLORS: true, // cycle the halo color through GEM_FACE_PALETTE
  CYCLE_PERIOD_SECONDS: 10.0, // one full palette cycle every N seconds
});

// ─── Animation ─────────────────────────────────────────────────────────────
// Read fresh each frame in the render loop, so changes apply immediately.
export interface GemAnimationConfig {
  ROTATION_SPEED: number;
  BOB_FREQUENCY: number;
  BOB_AMPLITUDE_FRAC: number;
  HOVER_SCALE: number;
  SCALE_LERP_SPEED: number;
}

export const GEM_ANIMATION = map<GemAnimationConfig>({
  ROTATION_SPEED: 1.0, // radians/sec multiplier
  BOB_FREQUENCY: 1.0, // bob cycles/sec multiplier
  BOB_AMPLITUDE_FRAC: 0.5, // vertical bob distance = radius × this
  HOVER_SCALE: 1.25, // gem grows by this factor on hover
  SCALE_LERP_SPEED: 0.1, // per-frame ease toward HOVER_SCALE
});
