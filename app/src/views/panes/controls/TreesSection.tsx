// views/panes/controls/TreesSection.tsx — Commit-driven trees: one per
// commit. Oldest commit closest to the gem; newest farthest. Height
// encodes commit AGE (older = taller), width encodes commit FILES,
// color interpolates between TREE_COLOR_SOLO_DAY and TREE_COLOR_BUSY_DAY
// by commits-per-day.

import { TREES, TREE_OUTLINE } from '@/state/settings/components/trees';
import { Section } from './Section';
import { CollapsibleSubgroup } from './CollapsibleSubgroup';
import { ColorField, NumberField, RangePairField, SliderField, ToggleField } from './Fields';

export function TreesSection() {
  return (
    <Section
      name="Trees"
      hint="One tree per commit — height tracks age, width + facets track file count, color tracks commits-per-day (same-day commits share a color)."
    >
      <CollapsibleSubgroup name="Visibility">
        <ToggleField
          label="Trees enabled"
          store={TREES}
          fieldKey="TREES_ENABLED"
          tip="Master toggle. When off, all tree canopies + trunks are hidden (mesh.visible flip — no rebuild)."
        />
      </CollapsibleSubgroup>

      <CollapsibleSubgroup name="Placement">
        <SliderField label="Edge inset (% of plane)" store={TREES} fieldKey="EDGE_INSET_PERCENT" min={0} max={50} step={1}
          tip="Trees stop short of the plane edge by this fraction of the SHORTER axis. Rebuild on change." />
        <SliderField label="Density falloff" store={TREES} fieldKey="TREE_DENSITY_FALLOFF" min={0} max={50} step={0.1}
          tip="How tightly trees cluster near the city. 0 = uniform spread. Higher = denser near city, sparser at edges (acceptance prob = (1 - dist/maxDist)^falloff). Very high values (>20) push almost every tree into a dense ring right at the city edge. Rebuild on change." />
      </CollapsibleSubgroup>

      <CollapsibleSubgroup name="Color by commits-per-day">
        <ColorField label="Busy-day color" store={TREES} fieldKey="TREE_COLOR_BUSY_DAY"
          tip="Color for commits on a busy day — many commits sharing the same date. Live." />
        <ColorField label="Solo-day color" store={TREES} fieldKey="TREE_COLOR_SOLO_DAY"
          tip="Color for commits on a solo day — only one commit that date. Live." />
        <ColorField label="Trunk color" store={TREES} fieldKey="TREE_TRUNK_COLOR"
          tip="Color of every tree trunk. Live." />
        <SliderField label="Shading strength" store={TREES} fieldKey="TREE_SHADING_STRENGTH" min={0} max={1} step={0.05}
          tip="Baked vertex-color gradient depth on the canopy. 0 = flat (no shading), 1 = fully dark at the base. Rebuild on change." />
      </CollapsibleSubgroup>

      <CollapsibleSubgroup name="Age desaturation">
        <ToggleField label="Age desaturation enabled" store={TREES} fieldKey="TREE_AGE_DESAT_ENABLED"
          tip="When on, older commits fade toward gray — newest commits keep full color, oldest are washed out. Live." />
        <RangePairField label="Saturation range" store={TREES} minKey="TREE_AGE_SATURATION_MIN" maxKey="TREE_AGE_SATURATION_MAX" min={0} max={100} step={1}
          tip="Saturation retained at the OLDEST (left) and NEWEST (right) commit — percent 0–100. At 20 the oldest tree keeps only 20% of its base color saturation; at 100 it is fully saturated. Live." />
      </CollapsibleSubgroup>

      <CollapsibleSubgroup name="Height by age">
        <SliderField label="Min height" store={TREES} fieldKey="TREE_MIN_HEIGHT" min={4} max={400} step={4}
          tip="Height (world units) of the newest commit. Older commits grow taller toward Max. Independent of building dimensions. Rebuild on change." />
        <SliderField label="Max height" store={TREES} fieldKey="TREE_MAX_HEIGHT" min={16} max={800} step={4}
          tip="Height (world units) of the oldest commit. Independent of building dimensions. Rebuild on change." />
        <SliderField label="Trunk height (% of canopy)" store={TREES} fieldKey="TRUNK_HEIGHT_FRAC" min={0.05} max={1} step={0.05}
          tip="Trunk height as a fraction of canopy height. Larger = more visible trunk relative to canopy. Rebuild on change." />
        <SliderField label="Canopy-trunk overlap (% of trunk)" store={TREES} fieldKey="CANOPY_TRUNK_OVERLAP_FRAC" min={0} max={1} step={0.05}
          tip="How much of the trunk top is hidden inside the canopy. 0 = canopy bottom point touches trunk top. 1 = canopy bottom reaches the ground, hiding the entire trunk. Rebuild on change." />
      </CollapsibleSubgroup>

      <CollapsibleSubgroup name="Width by files">
        <SliderField label="Min canopy width" store={TREES} fieldKey="TREE_MIN_WIDTH" min={2} max={400} step={2}
          tip="Canopy diameter (world units) of commits with the fewest files changed. Independent of building dimensions. Rebuild on change." />
        <SliderField label="Max canopy width" store={TREES} fieldKey="TREE_MAX_WIDTH" min={4} max={600} step={2}
          tip="Canopy diameter (world units) of commits with the most files changed. Independent of building dimensions. Rebuild on change." />
        <SliderField label="Trunk thickness (% of canopy)" store={TREES} fieldKey="TRUNK_RADIUS_FRAC_OF_CANOPY" min={0.05} max={0.5} step={0.01}
          tip="Trunk XZ radius as a fraction of canopy radius. Wider canopies get thicker trunks proportionally. Rebuild on change." />
        <SliderField label="Age shrink floor" store={TREES} fieldKey="TREE_WIDTH_AGE_FLOOR" min={0} max={1} step={0.05}
          tip="Multiplier on file-driven canopy width at the SHORTEST (newest) tree. 1 = no shrink; 0.5 = half-width saplings; 0 = strict height-proportional. Tallest trees always render at full width. Rebuild on change." />
      </CollapsibleSubgroup>

      <CollapsibleSubgroup name="Facets by files">
        <SliderField label="Low-tier facets" store={TREES} fieldKey="TREE_FACETS_LOW" min={3} max={24} step={1}
          tip="Radial segment count for trees in the smallest-commit tier. 3 = triangular prism (chunkiest); higher = smoother. Lowest tier holds the largest tree count so this is the perf-sensitive knob." />
        <SliderField label="Mid-tier facets" store={TREES} fieldKey="TREE_FACETS_MID" min={3} max={24} step={1}
          tip="Radial segment count for the middle-commit tier." />
        <SliderField label="High-tier facets" store={TREES} fieldKey="TREE_FACETS_HIGH" min={3} max={32} step={1}
          tip="Radial segment count for the largest-commit tier. Highest tier has the fewest tree instances so this is the cheapest knob to push high." />
      </CollapsibleSubgroup>

      <CollapsibleSubgroup name="Outlines">
        <NumberField label="Linewidth" store={TREE_OUTLINE} fieldKey="WIDTH" min={1} max={10} step={1}
          tip="Pixel thickness shared by hover and selected canopy outlines." />
        <ColorField label="Hover color" store={TREE_OUTLINE} fieldKey="HOVER_COLOR"
          tip="Outline color when a tree is hovered (not selected)." />
        <SliderField label="Hover opacity" store={TREE_OUTLINE} fieldKey="HOVER_OPACITY" min={0} max={1} step={0.05} />
        <SliderField label="Selected opacity" store={TREE_OUTLINE} fieldKey="SELECTED_OPACITY" min={0} max={1} step={0.05}
          tip="Selected outline uses an animated rainbow color — see Effects > Rainbow." />
      </CollapsibleSubgroup>
    </Section>
  );
}
