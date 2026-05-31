// views/panes/controls/IslandSection.tsx — Floating-island world-plane
// beneath the city. Geometry controls the polygon silhouette + depth;
// Materials set the baked vertex colors + hemispheric lighting.

import { ISLAND_GEOMETRY, ISLAND_MATERIALS } from '@/state/settings/components/island';
import { Section } from './Section';
import { CollapsibleSubgroup } from './CollapsibleSubgroup';
import { ColorField, SliderField, ToggleField } from './Fields';

export function IslandSection() {
  return (
    <Section
      name="Island"
      hint="Floating-island world-plane beneath the city. Geometry controls the polygon silhouette and depth; Materials set the baked colors and lighting."
    >
      <CollapsibleSubgroup name="Geometry">
        <ToggleField
          label="Show island"
          store={ISLAND_GEOMETRY}
          fieldKey="ENABLED"
          tip="Master toggle for the floating-island mesh. When off, the city sits over empty sky."
        />
        <SliderField
          label="Polygon sides"
          store={ISLAND_GEOMETRY}
          fieldKey="SIDES"
          min={6}
          max={48}
          step={1}
          tip="How many sides the island top has. Also drives triangle density horizontally — each side contributes 2 triangles per tier band. 6 = hexagon (chunky big facets); 12 = dodecagon (default); 48 = lots of small facets."
        />
        <SliderField
          label="Irregularity"
          store={ISLAND_GEOMETRY}
          fieldKey="IRREGULARITY"
          min={0}
          max={0.5}
          step={0.01}
          tip="0 = perfectly regular polygon. Higher values jitter vertices inward for a natural island silhouette."
        />
        <SliderField
          label="Tier rings"
          store={ISLAND_GEOMETRY}
          fieldKey="TIERS"
          min={1}
          max={10}
          step={1}
          tip="How many chunky tier rings make up the underside. 1 = sharp cone; 4–6 = chunky tapered look; 10 = lots of facet detail."
        />
        <SliderField
          label="Depth (× radius)"
          store={ISLAND_GEOMETRY}
          fieldKey="DEPTH"
          min={0.2}
          max={2.0}
          step={0.05}
          tip={'Total island depth as a fraction of island radius. Larger = deeper, more "iceberg" silhouette.'}
        />
        <SliderField
          label="Roundness"
          store={ISLAND_GEOMETRY}
          fieldKey="ROUNDNESS"
          min={0}
          max={1}
          step={0.05}
          tip="Body shape. 0 = pointed taper to a tip; 1 = very rounded bowl. 0.7 = the current default smooth-rounded shape."
        />
        <SliderField
          label="Grass thickness"
          store={ISLAND_GEOMETRY}
          fieldKey="GRASS_THICKNESS"
          min={0}
          max={0.1}
          step={0.005}
          tip="Vertical thickness of the green grass layer as a fraction of island radius. 0 = no grass band, just the flat top."
        />
      </CollapsibleSubgroup>

      <CollapsibleSubgroup name="Materials">
        <ColorField
          label="Grass color"
          store={ISLAND_MATERIALS}
          fieldKey="GRASS_COLOR"
          tip="Top surface where the city sits."
        />
        <ColorField
          label="Grass side color"
          store={ISLAND_MATERIALS}
          fieldKey="GRASS_SIDE_COLOR"
          tip="Vertical band wrapping the top edge. Side faces point outward, so hemispheric lighting hits them very differently than the top — tune this brighter than Grass color if the side band reads too dim."
        />
        <ColorField
          label="Rock color"
          store={ISLAND_MATERIALS}
          fieldKey="ROCK_COLOR"
          tip="Uniform rock/earth color for the cliff band, tier rings, and bottom cap. Per-face lighting provides all the visual variation."
        />
        <ColorField
          label="Hemi sky color"
          store={ISLAND_MATERIALS}
          fieldKey="HEMI_SKY_COLOR"
          tip={'Warm "from above" tone blended onto upward-facing surfaces by the hemispheric lighting model.'}
        />
        <ColorField
          label="Hemi ground color"
          store={ISLAND_MATERIALS}
          fieldKey="HEMI_GROUND_COLOR"
          tip={'Cool "from below" tone blended onto downward-facing surfaces by the hemispheric lighting model.'}
        />
      </CollapsibleSubgroup>
    </Section>
  );
}
