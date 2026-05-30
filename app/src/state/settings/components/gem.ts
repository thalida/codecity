// state/settings/gem.js — Root-of-repo gem: sizing (rebuild-required), face palette
// (applied on Save via vertex color buffer rewrite), edge color (applied on Save via applyTheme()),
// and animation tuning (applied on Save via applyTheme(); read fresh per frame).

import { signal } from '@preact/signals';
import { oklchToHex } from '@/scene/utils/color/colors';

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

export const GEM_SIZING = signal<GemSizingConfig>({
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
// 8 hex colors used to tint the gem's faces. The renderer cycles through
// this list with `faces[i % 8]`, so it works for shapes with fewer faces
// (tetrahedron uses the first 4) and more (icosahedron's 20 faces cycle
// through twice + 4). Applied on Save via applyTheme().
//
// Defaults are generated as an OKLCH rainbow — fixed lightness + chroma
// at 8 evenly-spaced hues. OKLCH is perceptually uniform, so each step
// looks like an equal hue jump (HSL-based rainbows make yellow read
// much brighter than blue at the same lightness, which gives uneven
// tone transitions across the gem). User overrides via Controls.
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

// OKLCH params for the default rainbow. Slightly more vibrant than the
// firefly orb palette (orbs use L=0.78, C=0.18); the gem benefits from
// higher chroma since each face is a large solid area, where the
// fireflies are tiny moving dots whose color already gets boosted by
// the additive bloom pass.
const FACE_L = 0.75;
const FACE_C = 0.22;
const FACE_COUNT = 8;
const faceHex = (i: number): string => oklchToHex(FACE_L, FACE_C, (i / FACE_COUNT) * 360);

export const GEM_FACE_PALETTE = signal<GemFacePaletteConfig>({
  FACE_1: faceHex(0),
  FACE_2: faceHex(1),
  FACE_3: faceHex(2),
  FACE_4: faceHex(3),
  FACE_5: faceHex(4),
  FACE_6: faceHex(5),
  FACE_7: faceHex(6),
  FACE_8: faceHex(7),
});

// ─── Appearance ────────────────────────────────────────────────────────────
// Edge color = neutral separator line drawn around the faces. Body opacity
// keeps the gem semi-transparent so the colored faces have a jewel-like
// quality (fully opaque feels like a plastic toy). Both applied on Save via applyTheme().
export interface GemAppearanceConfig {
  EDGE_COLOR: string;
  BODY_OPACITY: number;
}

export const GEM_APPEARANCE = signal<GemAppearanceConfig>({
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

export const GEM_GLOW = signal<GemGlowConfig>({
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

export const GEM_ANIMATION = signal<GemAnimationConfig>({
  ROTATION_SPEED: 1.0, // radians/sec multiplier
  BOB_FREQUENCY: 1.0, // bob cycles/sec multiplier
  BOB_AMPLITUDE_FRAC: 0.5, // vertical bob distance = radius × this
  HOVER_SCALE: 1.25, // gem grows by this factor on hover
  SCALE_LERP_SPEED: 0.1, // per-frame ease toward HOVER_SCALE
});
