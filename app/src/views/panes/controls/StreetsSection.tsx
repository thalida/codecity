// views/panes/controls/StreetsSection.tsx — Road network sizing + packing,
// plus the asphalt, sidewalks, labels, footprint, and route-highlight
// visuals that paint on top.

import {
  STREETS,
  STREET_LAYOUT,
  STREET_TIERS,
} from '@/state/settings/index';
import { FOOTPRINT } from '@/state/settings/components/footprint';
import { Section } from './Section';
import { CollapsibleSubgroup } from './CollapsibleSubgroup';
import { ColorField, NumberField, SliderField, ToggleField, TierWidthSliderField } from './Fields';

export function StreetsSection() {
  // Width tiers — one slider per tier. Read the array layout once on mount;
  // tier count rarely changes (defined by the registered default).
  const tiers = STREET_TIERS.value;
  return (
    <Section
      name="Streets"
      hint="Road network sizing + packing, plus the asphalt, sidewalks, labels, footprint, and route-highlight visuals that paint on top."
    >
      <CollapsibleSubgroup name="Street width tiers">
        {tiers.map((tier, i) => (
          <TierWidthSliderField key={`tier-${i}`} index={i} minDescendants={tier.min_descendants} />
        ))}
      </CollapsibleSubgroup>

      <CollapsibleSubgroup name="Street spacing">
        <NumberField label="Sibling gap" store={STREET_LAYOUT} fieldKey="CHILD_GAP" min={0} max={50} step={1}
          tip="Distance between sibling children (file or subdir) packed along a street. 50 world units is roughly two MAX_WIDTH building footprints — beyond this streets balloon noticeably." />
        <NumberField label="Root end pad" store={STREET_LAYOUT} fieldKey="ROOT_END_PAD" min={0} max={50} step={1}
          tip="Fallback pad at each end of the root street (which has no parent intersection). 50 world units is roughly two MAX_WIDTH building footprints — beyond this streets balloon noticeably." />
        <NumberField label="Parent join pad" store={STREET_LAYOUT} fieldKey="PARENT_JOIN_PAD" min={0} max={50} step={1}
          tip="Extra clear space where a child street meets its parent. 50 world units is roughly two MAX_WIDTH building footprints — beyond this streets balloon noticeably." />
      </CollapsibleSubgroup>

      <CollapsibleSubgroup name="Asphalt">
        <ColorField label="Color" store={STREETS} fieldKey="ASPHALT_COLOR"
          tip="Color of the inner road stripe. Live." />
      </CollapsibleSubgroup>

      <CollapsibleSubgroup name="City footprint">
        <ToggleField label="Enabled" store={FOOTPRINT} fieldKey="ENABLED"
          tip="When off, the slab is hidden (still built; group.visible = false) and tree/bush placement no longer rejects candidates inside the halo." />
        <ColorField label="Color" store={FOOTPRINT} fieldKey="COLOR"
          tip="Slab color. Near-black by default so the apron reads as a darker frame around the city against the night-scene floor." />
        <NumberField label="Halo width" store={FOOTPRINT} fieldKey="HALO_WIDTH" min={0} max={256} step={4}
          tip="World units of asphalt added outward around every layout rect. ~32 (one narrow-street width) is the design default; above 256 the halo dwarfs the city and reads as a paved plaza." />
        <SliderField label="Halo radius × halo width" store={FOOTPRINT} fieldKey="CORNER_RADIUS" min={0} max={2} step={0.05}
          tip="Corner radius as a fraction of Halo width above (0 = sharp, 1 = one halo width, 2 = two). World-units radius pushed to the shader = this × Halo width. Where rects overlap heavily the rounding is hidden by neighbors; the radius only shows where a rect ends at the silhouette." />
      </CollapsibleSubgroup>

      <CollapsibleSubgroup name="Sidewalk colors">
        <ColorField label="Default" store={STREETS} fieldKey="SIDEWALK_DEFAULT"
          tip="Resting tint on every sidewalk." />
        <ColorField label="Hover" store={STREETS} fieldKey="SIDEWALK_HOVER"
          tip="When the cursor is over a street." />
        <ColorField label="Selected" store={STREETS} fieldKey="SIDEWALK_SELECTED"
          tip="When a street (directory) is selected." />
      </CollapsibleSubgroup>

      <CollapsibleSubgroup name="Street labels">
        <ColorField label="Text color" store={STREETS} fieldKey="LABEL_FILL"
          tip="Text color of the names painted on each road." />
        <ColorField label="Outline color" store={STREETS} fieldKey="LABEL_STROKE"
          tip="Outline color of the label text — typically darker than the fill so the label reads against any asphalt color." />
        <SliderField label="Outline width" store={STREETS} fieldKey="LABEL_STROKE_WIDTH_FRAC" min={0} max={0.5} step={0.01}
          tip="Text outline thickness, as a fraction of the rendered character height. Above 0.5 the stroke overwhelms the glyph fill." />
        <SliderField label="Label size" store={STREETS} fieldKey="LABEL_HEIGHT_FRAC" min={0} max={2} step={0.05}
          tip="Label height as a fraction of the street width. Wider streets get bigger labels. Above 2× the street width labels clip into adjacent rows." />
      </CollapsibleSubgroup>

      <CollapsibleSubgroup name="Path lines">
        <SliderField label="Line width %" store={STREETS} fieldKey="PATH_LINEWIDTH_PCT" min={1} max={50} step={1}
          tip="Shared thickness for both the rainbow selection line and the hover-preview line, as a % of the narrowest street tier width." />
        <SliderField label="Selection opacity" store={STREETS} fieldKey="PATH_OPACITY" min={0} max={1} step={0.05}
          tip="Selection-line transparency. 0 = invisible; 1 = solid." />
        <ColorField label="Hover preview color" store={STREETS} fieldKey="HOVER_PATH_COLOR"
          tip="Solid color of the hover-preview line. Faded white by default so it reads as a draft, not the committed selection." />
        <SliderField label="Hover preview opacity" store={STREETS} fieldKey="HOVER_PATH_OPACITY" min={0} max={1} step={0.05}
          tip="Hover-preview transparency. 0 = invisible; 1 = solid." />
      </CollapsibleSubgroup>
    </Section>
  );
}
