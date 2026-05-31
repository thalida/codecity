// views/panes/controls/SceneSection.tsx — Backdrop knobs: sky color,
// stars, ground sizing, ground haze. Sun lighting is fixed in code so
// no controls for it here.

import { SCENE_COLORS } from '@/state/settings/index';
import { SKY, SKY_STARS } from '@/state/settings/components/sky';
import { WORLD } from '@/state/settings/world/world';
import { Section } from './Section';
import { CollapsibleSubgroup } from './CollapsibleSubgroup';
import { ColorField, SliderField, ToggleField } from './Fields';

export function SceneSection() {
  return (
    <Section
      name="Scene"
      hint="Sky, stars, ground, and atmosphere — everything that frames the city. (Sun lighting is fixed in code.)"
    >
      <CollapsibleSubgroup name="Sky">
        <ColorField
          label="Sky color"
          store={SKY}
          fieldKey="COLOR"
          tip="Solid color painted across the entire sphere. Past the world floor edge the camera sees this color directly, so the plane reads as floating in space."
        />
      </CollapsibleSubgroup>

      <CollapsibleSubgroup name="Stars">
        <ToggleField
          label="Enabled"
          store={SKY_STARS}
          fieldKey="ENABLED"
          tip="When off, no stars are sampled (also disables twinkle)."
        />
        <SliderField
          label="Density"
          store={SKY_STARS}
          fieldKey="DENSITY"
          min={0}
          max={0.02}
          step={0.0005}
          tip="Hash-threshold for star presence — higher density paints MORE stars. Above ~0.01 the sky reads as a noise field."
        />
      </CollapsibleSubgroup>

      <CollapsibleSubgroup name="Ground sizing">
        <SliderField
          label="Ground buffer (% of city)"
          store={WORLD}
          fieldKey="GROUND_BUFFER_PERCENT"
          min={0}
          max={100}
          step={1}
          tip="Padding around the city as a percentage of the city's longest dimension. 0% = island exactly fits the city; 50% = generous halo of bare ground past the buildings."
        />
      </CollapsibleSubgroup>

      <CollapsibleSubgroup name="Ground haze">
        <ToggleField
          label="Enabled"
          store={SCENE_COLORS}
          fieldKey="FOG_ENABLED"
          tip="Off → no haze (the shader's fog mix is a no-op). Other knobs stay in config so flipping back restores the mood."
        />
        <ColorField
          label="Color"
          store={SCENE_COLORS}
          fieldKey="FOG_COLOR"
          tip="Tint that building bases mix toward. Match the sky/ground for a seamless horizon."
        />
        <SliderField
          label="Intensity"
          store={SCENE_COLORS}
          fieldKey="FOG_INTENSITY"
          min={0}
          max={1}
          step={0.05}
          tip="Peak fog amount at world Y=0 (street level). 0 = off; 1 = ground plane fully tinted to fog color."
        />
        <SliderField
          label="Falloff height ×"
          store={SCENE_COLORS}
          fieldKey="FOG_HEIGHT_FRAC"
          min={0}
          max={1}
          step={0.05}
          tip="Half-fall-off height as a fraction of the tallest possible building (BUILDING_DIMENSIONS.MAX_FLOORS × FLOOR_HEIGHT). Auto-scales with the building config so the mist sits in the same relative band of the skyline. 0.25 = mist fades by mid-height of short buildings; 0.5 = halfway up the tallest."
        />
      </CollapsibleSubgroup>
    </Section>
  );
}
