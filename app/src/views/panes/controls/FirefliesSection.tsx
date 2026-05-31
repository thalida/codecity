// views/panes/controls/FirefliesSection.tsx — Glowing motes that orbit
// each commit-tree, colored per author.

import { FIREFLIES } from '@/state/settings/components/fireflies';
import { Section } from './Section';
import { CollapsibleSubgroup } from './CollapsibleSubgroup';
import { SliderField, ToggleField } from './Fields';

export function FirefliesSection() {
  return (
    <Section
      name="Fireflies"
      hint="Glowing motes that orbit each commit-tree, colored per author."
    >
      <CollapsibleSubgroup name="Visibility">
        <ToggleField label="Fireflies enabled" store={FIREFLIES} fieldKey="FIREFLIES_ENABLED"
          tip="Master toggle. When off, no firefly orbs are placed or rendered. Rebuild on change." />
      </CollapsibleSubgroup>

      <CollapsibleSubgroup name="Size">
        <SliderField label="Scale min" store={FIREFLIES} fieldKey="SCALE_MIN" min={0.1} max={2.0} step={0.05}
          tip="Multiplier for the author with the fewest commits. Rebuild on change." />
        <SliderField label="Scale max" store={FIREFLIES} fieldKey="SCALE_MAX" min={0.5} max={5.0} step={0.05}
          tip="Multiplier for the author with the most commits. Rebuild on change." />
      </CollapsibleSubgroup>

      <CollapsibleSubgroup name="Motion">
        <SliderField label="Orbit speed" store={FIREFLIES} fieldKey="ORBIT_SPEED" min={0} max={3.0} step={0.05}
          tip="How fast each firefly orbits its tree, radians/sec. 0 = stationary." />
        <SliderField label="Bob amplitude" store={FIREFLIES} fieldKey="BOB_AMPLITUDE" min={0} max={2.0} step={0.05}
          tip="How far each orb drifts up and down in world units. 0 = no vertical movement." />
        <SliderField label="Bob speed" store={FIREFLIES} fieldKey="BOB_SPEED" min={0} max={5.0} step={0.1}
          tip="How fast the vertical bob oscillates in radians/sec. Higher = faster bobbing." />
      </CollapsibleSubgroup>

      <CollapsibleSubgroup name="Brightness">
        <SliderField label="Emission strength" store={FIREFLIES} fieldKey="EMISSION_STRENGTH" min={0} max={5.0} step={0.1}
          tip="Base brightness multiplier. >1 makes orbs glow (bloom). Lower = subtler." />
        <SliderField label="Pulse amplitude" store={FIREFLIES} fieldKey="PULSE_AMPLITUDE" min={0} max={1.0} step={0.05}
          tip="Brightness swing. 0 = steady glow, 1 = full ±100% modulation." />
        <SliderField label="Pulse speed" store={FIREFLIES} fieldKey="PULSE_SPEED" min={0} max={5.0} step={0.1}
          tip="How fast the pulse oscillates, radians/sec." />
        <SliderField label="Flicker" store={FIREFLIES} fieldKey="FLICKER_AMOUNT" min={0} max={1.0} step={0.05}
          tip="Random brightness jitter on top of the pulse. 0 = smooth, 1 = jittery." />
      </CollapsibleSubgroup>

      <CollapsibleSubgroup name="Orbit ring">
        <ToggleField label="Show orbit ring" store={FIREFLIES} fieldKey="ORBIT_RING_ENABLED"
          tip="Draws a subtle ring around each tree showing the firefly's orbital path." />
        <SliderField label="Ring thickness" store={FIREFLIES} fieldKey="ORBIT_RING_THICKNESS" min={0.02} max={0.5} step={0.01}
          tip="Tube radius of the orbit ring in world units. Rebuilds geometry on change." />
      </CollapsibleSubgroup>
    </Section>
  );
}
