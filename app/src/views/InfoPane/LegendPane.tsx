// views/InfoPane/LegendPane.tsx — the "Legend" subtab: a static map-key for how
// a repo's structure and history become the 3D city. Each world layer renders
// as an accented header + a list of cue → meaning rows, read from LAYER_LEGEND
// (single-sourced with the Overview section tooltips). A trailing "Reading the
// city" group covers the non-layer cues. No manifest: the encodings are
// identical for every project. Body-only; InfoPane owns chrome.

import './LegendPane.css';
import { Gem, Contrast } from 'lucide-preact';
import type { LucideIcon } from 'lucide-preact';
import { LAYER_LEGEND } from './almanac';
import type { LayerCue } from './almanac';
import { SECTION_ICON } from './sectionIcons';

// The non-layer cues — a landmark and an interaction affordance with no
// manifest-derived source, so their copy lives here (the Legend is their only
// consumer). Verified against the gem + building-fader render behavior.
interface WorldCue {
  icon: LucideIcon;
  title: string;
  rule: string;
}

const WORLD_CUES: WorldCue[] = [
  {
    icon: Gem,
    title: 'Root gem',
    rule: "A gem marks the project root at the city's origin: click it to clear your selection and recenter the camera.",
  },
  {
    icon: Contrast,
    title: 'Hover fade',
    rule: 'Hovering or selecting a building fades the rest by how far they sit in the folder tree: near neighbors stay bright, distant ones dim to ghosts.',
  },
];

/** One world layer: accented glyph + name, a lead line, then its cue → meaning
 *  rows. `data-section` drives the row's --sec-accent from the shared map. */
function LayerBlock({ layerKey }: { layerKey: (typeof LAYER_LEGEND)[number]['key'] }) {
  const layer = LAYER_LEGEND.find((l) => l.key === layerKey)!;
  const Icon = SECTION_ICON[layer.key];
  return (
    <section class="legend-layer" data-section={layer.key}>
      <h3 class="legend-layer-title">
        <Icon class="lucide-icon legend-layer-icon" aria-hidden="true" />
        {layer.title}
      </h3>
      <p class="legend-layer-lead">{layer.lead}</p>
      <dl class="legend-cues">
        {layer.cues.map((c: LayerCue) => (
          <div key={c.label} class="legend-cue">
            <dt class="legend-cue-label">{c.label}</dt>
            <dd class="legend-cue-detail">{c.detail}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function LegendPane() {
  return (
    <div class="legend">
      <p class="legend-intro">How a repo's structure and history become this city.</p>
      {LAYER_LEGEND.map((l) => (
        <LayerBlock key={l.key} layerKey={l.key} />
      ))}
      <h3 class="legend-group-title">Reading the city</h3>
      <ul class="legend-cue-list">
        {WORLD_CUES.map((c) => (
          <li key={c.title} class="legend-row">
            <c.icon class="lucide-icon legend-row-icon" aria-hidden="true" />
            <div class="legend-row-text">
              <span class="legend-row-title">{c.title}</span>
              <span class="legend-row-rule">{c.rule}</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
