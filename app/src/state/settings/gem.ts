// state/settings/gem.ts — Root-of-repo gem + its repo-label hologram.
//
// Three stores, all in the Gem panel section:
//   GEM        — the gem's VISUAL config (shape/appearance/face palette/
//                animation/glow), one flat store; the glow sub-feature is
//                prefixed GLOW_*.
//   GEM_SIZING — LAYOUT sizing (radius), kept separate because it's threaded
//                into the layout worker (lean snapshot), same as WORLD.
//   REPO_LABEL — the floating holographic repo-name banner; its own feature
//                with its own component (repoLabel.ts), kept separate.
//
// Schema-driven (see state/settings/schema). Non-tunable layout constants
// (gem hover-lift, gem clearance) were evicted to their consumers.

import { settingSignal, FieldKind, ChangeRoute, type ConfigOf, type FieldMap } from '@/state/settings/schema';
import { oklchToHex } from '@/scene/utils/color/colors';

// Default face palette: an OKLCH rainbow (perceptually uniform) at 8 evenly
// spaced hues — fixed lightness + chroma. The gem cycles faces[i % 8].
const FACE_L = 0.75;
const FACE_C = 0.22;
const faceHex = (i: number): string => oklchToHex(FACE_L, FACE_C, (i / 8) * 360);

const GEM_FIELDS = {
  // ── Shape ──
  SIDES: { route: ChangeRoute.Rebuild, kind: FieldKind.Select, default: '8', label: 'Sides',
    options: [
      { value: '4', label: '4' },
      { value: '8', label: '8' },
      { value: '20', label: '20' },
    ],
    tip: 'Polyhedron face count. 4 = tetrahedron, 8 = octahedron, 20 = icosahedron. Per-face colors cycle through the Face colors palette.' },

  // ── Appearance ──
  EDGE_COLOR: { route: ChangeRoute.Refresh, kind: FieldKind.Color, default: '#ffffff', label: 'Edge color',
    tip: 'Neutral separator line drawn around each gem face.' },
  BODY_OPACITY: { route: ChangeRoute.Refresh, kind: FieldKind.Slider, default: 0.75, min: 0, max: 1, step: 0.05, label: 'Body opacity',
    tip: 'Gem transparency. Low = jewel-like; high = plastic.' },

  // ── Face colors ──
  FACE_1: { route: ChangeRoute.Refresh, kind: FieldKind.Color, default: faceHex(0), label: 'Face 1' },
  FACE_2: { route: ChangeRoute.Refresh, kind: FieldKind.Color, default: faceHex(1), label: 'Face 2' },
  FACE_3: { route: ChangeRoute.Refresh, kind: FieldKind.Color, default: faceHex(2), label: 'Face 3' },
  FACE_4: { route: ChangeRoute.Refresh, kind: FieldKind.Color, default: faceHex(3), label: 'Face 4' },
  FACE_5: { route: ChangeRoute.Refresh, kind: FieldKind.Color, default: faceHex(4), label: 'Face 5' },
  FACE_6: { route: ChangeRoute.Refresh, kind: FieldKind.Color, default: faceHex(5), label: 'Face 6' },
  FACE_7: { route: ChangeRoute.Refresh, kind: FieldKind.Color, default: faceHex(6), label: 'Face 7' },
  FACE_8: { route: ChangeRoute.Refresh, kind: FieldKind.Color, default: faceHex(7), label: 'Face 8' },

  // ── Glow halo (sub-feature) ──
  GLOW_ENABLED: { route: ChangeRoute.Refresh, kind: FieldKind.Toggle, default: true, label: 'Enabled',
    tip: 'Two billboarded sprites behind the gem painted with a soft radial-gradient — creates a fuzzy neon halo.' },
  GLOW_INNER_SCALE: { route: ChangeRoute.Refresh, kind: FieldKind.Slider, default: 4.0, min: 1, max: 12, step: 0.1, label: 'Inner scale × radius',
    tip: 'Size of the inner "hot core" halo, as a multiple of the gem radius. Larger = bigger soft disk. Beyond 12× radius the inner core overlaps the outer halo.' },
  GLOW_INNER_OPACITY: { route: ChangeRoute.Refresh, kind: FieldKind.Slider, default: 0.75, min: 0, max: 1, step: 0.05, label: 'Inner opacity',
    tip: 'Brightness of the hot core. Lower for a subtler halo.' },
  GLOW_OUTER_SCALE: { route: ChangeRoute.Refresh, kind: FieldKind.Slider, default: 15.0, min: 1, max: 30, step: 0.5, label: 'Outer scale × radius',
    tip: 'Size of the outer atmospheric halo. Much larger than the inner one so the falloff reaches far past the gem. Beyond 30× radius the outer halo extends past the typical camera frame.' },
  GLOW_OUTER_OPACITY: { route: ChangeRoute.Refresh, kind: FieldKind.Slider, default: 0.5, min: 0, max: 1, step: 0.05, label: 'Outer opacity',
    tip: 'Brightness of the atmospheric halo.' },
  GLOW_ANIMATE_COLORS: { route: ChangeRoute.Refresh, kind: FieldKind.Toggle, default: true, label: 'Animate colors',
    tip: 'Cycle the halo color through the gem face palette. Off = halo uses the edge color from Appearance above.' },
  GLOW_CYCLE_PERIOD_SECONDS: { route: ChangeRoute.Refresh, kind: FieldKind.Slider, default: 10.0, min: 1, max: 30, step: 0.5, label: 'Cycle period (s)',
    tip: 'Seconds for one full pass through every palette color. Below 1s reads as flicker; above 30s the cycle feels static.' },

  // ── Animation ──
  ROTATION_SPEED: { route: ChangeRoute.Live, kind: FieldKind.Slider, default: 1.0, min: 0, max: 3, step: 0.05, label: 'Rotation speed',
    tip: 'Radians per second. Above 3 rad/sec the gem looks frantic.' },
  BOB_FREQUENCY: { route: ChangeRoute.Live, kind: FieldKind.Slider, default: 1.0, min: 0, max: 5, step: 0.1, label: 'Bob frequency',
    tip: 'How fast the gem oscillates vertically. Above 5 cycles/sec it reads as vibration, not bobbing.' },
  BOB_AMPLITUDE_FRAC: { route: ChangeRoute.Live, kind: FieldKind.Slider, default: 0.5, min: 0, max: 2, step: 0.05, label: 'Bob amplitude',
    tip: 'Vertical bob distance, as a fraction of the gem radius. Above 2× radius the gem flies off the street.' },
  HOVER_SCALE: { route: ChangeRoute.Live, kind: FieldKind.Slider, default: 1.25, min: 1, max: 3, step: 0.05, label: 'Hover scale',
    tip: 'Multiplier applied to the gem when the cursor is over it. Above 3× the gem dominates the scene on hover.' },
  SCALE_LERP_SPEED: { route: ChangeRoute.Live, kind: FieldKind.Slider, default: 0.1, min: 0.01, max: 1, step: 0.01, label: 'Hover lerp',
    tip: 'Per-frame ease toward the hover scale.' },
} satisfies FieldMap;

export const GEM = settingSignal('GEM', GEM_FIELDS);
export type GemConfig = ConfigOf<typeof GEM_FIELDS>;

// Layout sizing — threaded into the tree/layout worker, so kept lean + separate
// from the visual GEM store (same rationale as WORLD).
const GEM_SIZING_FIELDS = {
  RADIUS_AS_STREET_FRAC: { route: ChangeRoute.Rebuild, kind: FieldKind.Slider, default: 0.5, min: 0.05, max: 1, step: 0.05, label: 'Radius × street width',
    tip: 'Gem radius relative to the root street width. Bigger gems demand more empty plaza space.' },
  MIN_RADIUS: { route: ChangeRoute.Rebuild, kind: FieldKind.Number, default: 8, min: 1, max: 50, step: 1, label: 'Min radius',
    tip: 'Floor for narrow root streets so the gem stays visible. Below 1 the gem vanishes; above 50 it dwarfs the root plaza.' },
} satisfies FieldMap;

export const GEM_SIZING = settingSignal('GEM_SIZING', GEM_SIZING_FIELDS);
export type GemSizingConfig = ConfigOf<typeof GEM_SIZING_FIELDS>;

const REPO_LABEL_FIELDS = {
  ENABLED: { route: ChangeRoute.Refresh, kind: FieldKind.Toggle, default: true, label: 'Enabled',
    tip: 'Master toggle for the floating holographic repo-name label.' },
  HEIGHT_PCT: { route: ChangeRoute.Refresh, kind: FieldKind.Slider, default: 85, min: 0, max: 200, step: 1, label: 'Height % of max building',
    tip: 'Panel bottom position as a percent of the tallest possible building (MAX_FLOORS × FLOOR_HEIGHT). 0 = island floor; 100 = level with the tallest possible building; 200 = double that.' },
  FONT_SIZE: { route: ChangeRoute.Refresh, kind: FieldKind.Slider, default: 128, min: 10, max: 300, step: 1, label: 'Font size',
    tip: "Panel (= text) height in world units. Default 96 matches BUILDING_DIMENSIONS.MAX_WIDTH — the label reads as roughly the same scale as the biggest possible single building. Width scales with text length so long names don't squish." },
  ANIMATION_SPEED: { route: ChangeRoute.Refresh, kind: FieldKind.Slider, default: 1.0, min: 0, max: 4, step: 0.05, label: 'Animation speed',
    tip: 'Multiplier on the holographic scanline / glitch rate. 0 freezes the label; 4 reads as frantic.' },
  OPACITY: { route: ChangeRoute.Refresh, kind: FieldKind.Slider, default: 0.9, min: 0, max: 1, step: 0.05, label: 'Opacity',
    tip: 'Master opacity. 0 invisible, 1 fully painted.' },
  BEAM_COLOR: { route: ChangeRoute.Refresh, kind: FieldKind.Color, default: '#bfb3ff', label: 'Beam color',
    tip: 'Color of the light beam rising from the gem.' },
  TEXT_COLOR: { route: ChangeRoute.Refresh, kind: FieldKind.Color, default: '#ffffff', label: 'Text color',
    tip: 'Tint applied to the holographic text. White preserves the chromatic-aberration look; other colors fold the aberration into the chosen hue.' },
} satisfies FieldMap;

export const REPO_LABEL = settingSignal('REPO_LABEL', REPO_LABEL_FIELDS);
export type RepoLabelConfig = ConfigOf<typeof REPO_LABEL_FIELDS>;
