// panes/InfoPane/tabs/LegendTab — the map key: each layer's cues and what they
// mean, off LAYER_LEGEND. No manifest, since the encodings are the same for
// every project.

import './LegendTab.css';
import { LAYER_LEGEND } from '../../almanac';
import type { LayerCue } from '../../almanac';
import { SECTION_ICON } from '../../sectionIcons';

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

export function LegendTab() {
  return (
    <div class="legend pane-inset">
      {LAYER_LEGEND.map((l) => (
        <LayerBlock key={l.key} layerKey={l.key} />
      ))}
    </div>
  );
}
