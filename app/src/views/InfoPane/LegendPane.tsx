// views/InfoPane/LegendPane.tsx — the "Legend" subtab: a static map-key for how
// a repo's structure and history become the 3D city. Each world layer renders
// as an accented header + a list of cue → meaning rows, read from LAYER_LEGEND
// (single-sourced with the Overview section tooltips). No manifest: the
// encodings are identical for every project. Body-only; InfoPane owns chrome.

import './LegendPane.css';
import { LAYER_LEGEND } from './almanac';
import type { LayerCue } from './almanac';
import { SECTION_ICON } from './sectionIcons';

/** One world layer: accented glyph + name, a lead line, then its cue → meaning
 *  rows. `data-section` drives the row's --sec-accent from the shared map. */
function LayerBlock({ layerKey }: { layerKey: (typeof LAYER_LEGEND)[number]['key'] }) {
  const layer = LAYER_LEGEND.find((l) => l.key === layerKey)!;
  const Icon = SECTION_ICON[layer.key];
  return (
    <section class="legend-layer" data-section={layer.key}>
      <h3 class="legend-layer-title text-label">
        <Icon class="icon legend-layer-icon" aria-hidden="true" />
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
    <div class="legend pane-inset">
      {LAYER_LEGEND.map((l) => (
        <LayerBlock key={l.key} layerKey={l.key} />
      ))}
    </div>
  );
}
