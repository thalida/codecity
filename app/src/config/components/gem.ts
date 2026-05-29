// config/gem.js — Root-of-repo gem: sizing (rebuild-required), face palette
// (applied on Save via vertex color buffer rewrite), edge color (applied on Save via applyTheme()),
// and animation tuning (applied on Save via applyTheme(); read fresh per frame).

import { map } from 'nanostores';

// ─── Sizing + landing zone ────────────────────────────────────────────────
// Layout reserves dead space around the gem based on these — changing any
// requires a re-layout.
export interface GemSizingConfig {
  RADIUS_AS_STREET_FRAC: number;
  MIN_RADIUS: number;
  HOVER_LIFT_FRAC: number;
  CLEARANCE_AS_GEM_WIDTH_FRAC: number;
  // Polyhedron family: '4' = tetrahedron, '8' = octahedron, '20' = icosahedron.
  // Stored as string because _select stores strings.
  SIDES: string;
}

export const GEM_SIZING = map<GemSizingConfig>({
  RADIUS_AS_STREET_FRAC: 0.5, // gem radius = root street width × this
  MIN_RADIUS: 8, // floor for narrow root streets
  HOVER_LIFT_FRAC: 0.5, // gem hovers above road = radius × this
  // Dead-space pad past the gem at the root street's origin end,
  // expressed as a multiple of the gem's diameter so the plaza always
  // scales with the gem rather than living in absolute world units.
  CLEARANCE_AS_GEM_WIDTH_FRAC: 1.0,
  SIDES: '8', // default octahedron
});

// ─── Face palette ──────────────────────────────────────────────────────────
// 8 vivid hex colors used to tint the gem's faces. The renderer cycles
// through this list with `faces[i % 8]`, so it works for shapes with
// fewer faces (tetrahedron uses the first 4) and more (icosahedron's
// 20 faces cycle through twice + 4). Applied on Save via applyTheme().
export interface GemFacePaletteConfig {
  FACE_1: string;
  FACE_2: string;
  FACE_3: string;
  FACE_4: string;
  FACE_5: string;
  FACE_6: string;
  FACE_7: string;
  FACE_8: string;
}

export const GEM_FACE_PALETTE = map<GemFacePaletteConfig>({
  FACE_1: '#ff99c5', // pastel pink
  FACE_2: '#ffc999', // pastel peach
  FACE_3: '#fffc99', // pastel yellow
  FACE_4: '#a5ff99', // pastel green
  FACE_5: '#99fffd', // pastel cyan
  FACE_6: '#99d3ff', // pastel sky
  FACE_7: '#beb3ff', // pastel lavender
  FACE_8: '#f099ff', // pastel orchid
});

// ─── Appearance ────────────────────────────────────────────────────────────
// Edge color = neutral separator line drawn around the faces. Body opacity
// keeps the gem semi-transparent so the colored faces have a jewel-like
// quality (fully opaque feels like a plastic toy). Both applied on Save via applyTheme().
export interface GemAppearanceConfig {
  EDGE_COLOR: string;
  BODY_OPACITY: number;
}

export const GEM_APPEARANCE = map<GemAppearanceConfig>({
  EDGE_COLOR: '#ffffff',
  BODY_OPACITY: 0.75,
});

// ─── Glow halo ─────────────────────────────────────────────────────────────
// Two billboarded sprite layers behind the gem, each painted with a
// soft radial-gradient alpha and additively blended. Sizes are
// multiples of the gem radius so the halo scales with the gem itself.
// All applied on Save via applyTheme().
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
