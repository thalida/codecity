// views/panes/controls/GemSection.tsx — The floating spinning
// octahedron above the root street: size, polyhedron face count,
// edge/face colors, glow halo, rotation/bob animation, and the
// repo-label hologram.

import {
  GEM_SIZING,
  GEM_FACE_PALETTE,
  GEM_APPEARANCE,
  GEM_GLOW,
  GEM_ANIMATION,
} from '@/state/settings/index';
import { REPO_LABEL } from '@/state/settings/components/repoLabel';
import { Section } from './Section';
import { CollapsibleSubgroup } from './CollapsibleSubgroup';
import { ColorField, NumberField, SelectField, SliderField, ToggleField } from './Fields';

const SIDES_OPTIONS = [
  { value: '4', label: '4' },
  { value: '8', label: '8' },
  { value: '20', label: '20' },
];

export function GemSection() {
  return (
    <Section name="Root gem" hint="The floating spinning octahedron above the root street.">
      <CollapsibleSubgroup name="Size & shape">
        <SliderField label="Radius × street width" store={GEM_SIZING} fieldKey="RADIUS_AS_STREET_FRAC" min={0.05} max={1} step={0.05}
          tip="Gem radius relative to the root street width. Bigger gems demand more empty plaza space." />
        <NumberField label="Min radius" store={GEM_SIZING} fieldKey="MIN_RADIUS" min={1} max={50} step={1}
          tip="Floor for narrow root streets so the gem stays visible. Below 1 the gem vanishes; above 50 it dwarfs the root plaza." />
        <SelectField label="Sides" store={GEM_SIZING} fieldKey="SIDES" options={SIDES_OPTIONS}
          tip="Polyhedron face count. 4 = tetrahedron, 8 = octahedron, 20 = icosahedron. Per-face colors cycle through the Face colors palette." />
      </CollapsibleSubgroup>

      <CollapsibleSubgroup name="Appearance">
        <ColorField label="Edge color" store={GEM_APPEARANCE} fieldKey="EDGE_COLOR"
          tip="Neutral separator line drawn around each gem face." />
        <SliderField label="Body opacity" store={GEM_APPEARANCE} fieldKey="BODY_OPACITY" min={0} max={1} step={0.05}
          tip="Gem transparency. Low = jewel-like; high = plastic." />
      </CollapsibleSubgroup>

      <CollapsibleSubgroup name="Face colors">
        <ColorField label="Face 1" store={GEM_FACE_PALETTE} fieldKey="FACE_1" />
        <ColorField label="Face 2" store={GEM_FACE_PALETTE} fieldKey="FACE_2" />
        <ColorField label="Face 3" store={GEM_FACE_PALETTE} fieldKey="FACE_3" />
        <ColorField label="Face 4" store={GEM_FACE_PALETTE} fieldKey="FACE_4" />
        <ColorField label="Face 5" store={GEM_FACE_PALETTE} fieldKey="FACE_5" />
        <ColorField label="Face 6" store={GEM_FACE_PALETTE} fieldKey="FACE_6" />
        <ColorField label="Face 7" store={GEM_FACE_PALETTE} fieldKey="FACE_7" />
        <ColorField label="Face 8" store={GEM_FACE_PALETTE} fieldKey="FACE_8" />
      </CollapsibleSubgroup>

      <CollapsibleSubgroup name="Glow halo">
        <ToggleField label="Enabled" store={GEM_GLOW} fieldKey="ENABLED"
          tip="Two billboarded sprites behind the gem painted with a soft radial-gradient — creates a fuzzy neon halo." />
        <SliderField label="Inner scale × radius" store={GEM_GLOW} fieldKey="INNER_SCALE" min={1} max={12} step={0.1}
          tip='Size of the inner "hot core" halo, as a multiple of the gem radius. Larger = bigger soft disk. Beyond 12× radius the inner core overlaps the outer halo.' />
        <SliderField label="Inner opacity" store={GEM_GLOW} fieldKey="INNER_OPACITY" min={0} max={1} step={0.05}
          tip="Brightness of the hot core. Lower for a subtler halo." />
        <SliderField label="Outer scale × radius" store={GEM_GLOW} fieldKey="OUTER_SCALE" min={1} max={30} step={0.5}
          tip="Size of the outer atmospheric halo. Much larger than the inner one so the falloff reaches far past the gem. Beyond 30× radius the outer halo extends past the typical camera frame." />
        <SliderField label="Outer opacity" store={GEM_GLOW} fieldKey="OUTER_OPACITY" min={0} max={1} step={0.05}
          tip="Brightness of the atmospheric halo." />
        <ToggleField label="Animate colors" store={GEM_GLOW} fieldKey="ANIMATE_COLORS"
          tip="Cycle the halo color through the gem face palette. Off = halo uses the edge color from Appearance above." />
        <SliderField label="Cycle period (s)" store={GEM_GLOW} fieldKey="CYCLE_PERIOD_SECONDS" min={1} max={30} step={0.5}
          tip="Seconds for one full pass through every palette color. Below 1s reads as flicker; above 30s the cycle feels static." />
      </CollapsibleSubgroup>

      <CollapsibleSubgroup name="Animation">
        <SliderField label="Rotation speed" store={GEM_ANIMATION} fieldKey="ROTATION_SPEED" min={0} max={3} step={0.05}
          tip="Radians per second. Above 3 rad/sec the gem looks frantic." />
        <SliderField label="Bob frequency" store={GEM_ANIMATION} fieldKey="BOB_FREQUENCY" min={0} max={5} step={0.1}
          tip="How fast the gem oscillates vertically. Above 5 cycles/sec it reads as vibration, not bobbing." />
        <SliderField label="Bob amplitude" store={GEM_ANIMATION} fieldKey="BOB_AMPLITUDE_FRAC" min={0} max={2} step={0.05}
          tip="Vertical bob distance, as a fraction of the gem radius. Above 2× radius the gem flies off the street." />
        <SliderField label="Hover scale" store={GEM_ANIMATION} fieldKey="HOVER_SCALE" min={1} max={3} step={0.05}
          tip="Multiplier applied to the gem when the cursor is over it. Above 3× the gem dominates the scene on hover." />
        <SliderField label="Hover lerp" store={GEM_ANIMATION} fieldKey="SCALE_LERP_SPEED" min={0.01} max={1} step={0.01}
          tip="Per-frame ease toward the hover scale." />
      </CollapsibleSubgroup>

      <CollapsibleSubgroup name="Repo label">
        <ToggleField label="Enabled" store={REPO_LABEL} fieldKey="ENABLED"
          tip="Master toggle for the floating holographic repo-name label." />
        <SliderField label="Height % of max building" store={REPO_LABEL} fieldKey="HEIGHT_PCT" min={0} max={200} step={1}
          tip="Panel bottom position as a percent of the tallest possible building (MAX_FLOORS × FLOOR_HEIGHT). 0 = island floor; 100 = level with the tallest possible building; 200 = double that." />
        <SliderField label="Font size" store={REPO_LABEL} fieldKey="FONT_SIZE" min={10} max={300} step={1}
          tip="Panel (= text) height in world units. Default 96 matches BUILDING_DIMENSIONS.MAX_WIDTH — the label reads as roughly the same scale as the biggest possible single building. Width scales with text length so long names don't squish." />
        <SliderField label="Animation speed" store={REPO_LABEL} fieldKey="ANIMATION_SPEED" min={0} max={4} step={0.05}
          tip="Multiplier on the holographic scanline / glitch rate. 0 freezes the label; 4 reads as frantic." />
        <SliderField label="Opacity" store={REPO_LABEL} fieldKey="OPACITY" min={0} max={1} step={0.05}
          tip="Master opacity. 0 invisible, 1 fully painted." />
        <ColorField label="Beam color" store={REPO_LABEL} fieldKey="BEAM_COLOR"
          tip="Color of the light beam rising from the gem." />
        <ColorField label="Text color" store={REPO_LABEL} fieldKey="TEXT_COLOR"
          tip="Tint applied to the holographic text. White preserves the chromatic-aberration look; other colors fold the aberration into the chosen hue." />
      </CollapsibleSubgroup>
    </Section>
  );
}
