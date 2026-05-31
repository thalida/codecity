// views/panes/controls/EffectsSection.tsx — Shared visual effects:
// rainbow color cycle (selected outline + path line) and the HDR bloom
// pass that drives window/gem/ad neon glow.

import { RAINBOW, BLOOM } from '@/state/settings/index';
import { Section } from './Section';
import { CollapsibleSubgroup } from './CollapsibleSubgroup';
import { SliderField, ToggleField } from './Fields';

export function EffectsSection() {
  return (
    <Section
      name="Effects"
      hint="Shared visual effects + per-cell level-of-detail thresholds."
    >
      <CollapsibleSubgroup name="Rainbow (selected outline + path line)">
        <SliderField label="Speed" store={RAINBOW} fieldKey="SPEED" min={0} max={0.005} step={0.0001}
          tip="Hue cycles per millisecond. The shared rainbow chases around the selected building outline AND the gem→selection path line." />
        <SliderField label="Saturation" store={RAINBOW} fieldKey="SATURATION" min={0} max={1} step={0.05} />
        <SliderField label="Lightness" store={RAINBOW} fieldKey="LIGHTNESS" min={0} max={1} step={0.05} />
      </CollapsibleSubgroup>

      <CollapsibleSubgroup name="Bloom (HDR neon glow)">
        <ToggleField label="Enabled" store={BLOOM} fieldKey="ENABLED"
          tip={'Off → bloom pass bypassed AND windows/gem stay LDR — approximates the pre-HDR "flat" look for side-by-side comparison. Other knobs stay in config.'} />
        <SliderField label="Window emission" store={BLOOM} fieldKey="WINDOW_EMISSION" min={0} max={3.0} step={0.05}
          tip="Peak HDR push for the freshest building's lit windows; scales linearly down to 0 for the oldest. The bloom pass's strength × radius then operates on that age-scaled HDR signal, so total glow tracks building age. 0 = no bloom from windows; 1 = moderate; 3 = full neon." />
        <SliderField label="Gem emission" store={BLOOM} fieldKey="GEM_EMISSION" min={0} max={5.0} step={0.1}
          tip="Multiplier on the root-gem's halo sprite colors. 0 = halos black (invisible); 1 = LDR (no bloom from gem); higher = HDR push that drives selective bloom on the gem, independent of Window emission." />
        <SliderField label="Ad emission" store={BLOOM} fieldKey="AD_EMISSION" min={0} max={5.0} step={0.1}
          tip="Multiplier on ad panel colors. Bright pixels in the texture push past 1.0 and bloom; dark pixels stay below threshold. 0 = panel black; 1 = LDR (no bloom); higher = neon storefront." />
        <SliderField label="Strength" store={BLOOM} fieldKey="STRENGTH" min={0} max={1} step={0.01}
          tip="Overall bloom intensity multiplier. 0 = bloom pass produces nothing; 1 = full strength." />
        <SliderField label="Radius" store={BLOOM} fieldKey="RADIUS" min={0} max={1.0} step={0.05}
          tip="How far each bright pixel's glow spreads. Lower = tighter halos; higher = soft diffuse glow." />
        <SliderField label="Threshold (cutoff)" store={BLOOM} fieldKey="THRESHOLD" min={0} max={2.0} step={0.05}
          tip="Luma CUTOFF — pixels below this value contribute nothing to bloom. NOT an intensity dial: lower threshold = more pixels qualify = more total bloom; higher = fewer pixels glow. ≥1.0 keeps matte walls (capped at 1.0) clean and only blooms the HDR-pushed window pixels." />
      </CollapsibleSubgroup>
    </Section>
  );
}
