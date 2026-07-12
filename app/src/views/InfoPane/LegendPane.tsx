// views/InfoPane/LegendPane.tsx — the "Legend" subtab: a static map-key for how
// a repo's structure and history become the 3D city. Each world layer's rule is
// read from LAYER_LEGEND (single-sourced with the Overview section tooltips); a
// trailing "Reading the city" group covers the two non-layer cues. No manifest:
// the encodings are identical for every project. Body-only; InfoPane owns chrome.

import './LegendPane.css';
import { Gem, Contrast } from 'lucide-preact';
import type { LucideIcon } from 'lucide-preact';
import { LAYER_LEGEND } from './almanac';
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

function LegendRow({
  icon: Icon,
  title,
  rule,
  section,
}: {
  icon: LucideIcon;
  title: string;
  rule: string;
  /** An AlmanacSectionKey drives the row's --sec-accent; absent → neutral. */
  section?: string;
}) {
  return (
    <li class="legend-row" data-section={section}>
      <Icon class="lucide-icon legend-row-icon" aria-hidden="true" />
      <div class="legend-row-text">
        <span class="legend-row-title">{title}</span>
        <span class="legend-row-rule">{rule}</span>
      </div>
    </li>
  );
}

export function LegendPane() {
  return (
    <div class="legend">
      <p class="legend-intro">How a repo's structure and history become this city.</p>
      <ul class="legend-list">
        {LAYER_LEGEND.map((l) => (
          <LegendRow
            key={l.key}
            icon={SECTION_ICON[l.key]}
            title={l.title}
            rule={l.rule}
            section={l.key}
          />
        ))}
      </ul>
      <h3 class="legend-group-title">Reading the city</h3>
      <ul class="legend-list">
        {WORLD_CUES.map((c) => (
          <LegendRow key={c.title} icon={c.icon} title={c.title} rule={c.rule} />
        ))}
      </ul>
    </div>
  );
}
