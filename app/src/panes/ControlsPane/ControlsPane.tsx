// panes/ControlsPane — the left sidebar's Settings pane: the World sections,
// all draft-backed, over the sticky Reset all / Discard / Save bar. Open-state
// is deliberately not persisted, so collapsing the pane bumps collapseNonce and
// every section remounts at its default.

import './ControlsPane.css';
import { useEffect, useState } from 'preact/hooks';
import { DynamicSection, type SectionNode } from './partials';
import { VIEW_SECTION } from './partials/View';
import { WORLD_SECTION } from './partials/World';
import { BUILDINGS_SECTION } from './partials/Buildings';
import { STREETS_SECTION } from './partials/Streets';
import { FOOTPRINT_SECTION } from './partials/Footprint';
import { GEM_SECTION } from './partials/Gem';
import { TREES_SECTION } from './partials/Trees';
import { FIREFLIES_SECTION } from './partials/Fireflies';
import { POST_PROCESSING_SECTION } from './partials/PostProcessing';
import { TIMELINE_SECTION } from './partials/Timeline';
import { ActionsBar } from './ActionsBar/ActionsBar';
import { Pane } from '@/components/Pane/Pane';
import { PaneHeader } from '@/components/PaneHeader/PaneHeader';

/** Every section the pane shows, hoisted so a test can assert the invariant:
 *  each field stages into Save/Discard/Reset, none writes through. */
// Ordered outside-in: where you look from, then the world, then the city, then
// what lives around it, then whole-frame passes.
export const CONTROLS_SECTIONS: SectionNode[] = [
  VIEW_SECTION,
  WORLD_SECTION,
  STREETS_SECTION,
  FOOTPRINT_SECTION,
  BUILDINGS_SECTION,
  GEM_SECTION,
  TREES_SECTION,
  FIREFLIES_SECTION,
  TIMELINE_SECTION,
  POST_PROCESSING_SECTION,
];

export interface ControlsPaneProps {
  onClose?: () => void;
  /** Hidden with the sidebar, which collapses every section so the panel
   *  reopens fresh. The parent just passes its own collapsed state. */
  collapsed?: boolean;
}

export function ControlsPane({ onClose, collapsed }: ControlsPaneProps) {
  // Sections/subgroups own their open-state locally; bumping this nonce on
  // collapse remounts them so each reopens collapsed.
  const [collapseNonce, setCollapseNonce] = useState(0);

  useEffect(() => {
    if (!collapsed) return;
    setCollapseNonce((n) => n + 1);
  }, [collapsed]);

  return (
    <Pane
      paneClass="controls-pane"
      headerSlot={<PaneHeader title="World settings" onClose={onClose} />}
      bodyClass="pane-inset"
      footerSlot={<ActionsBar />}
    >
      {CONTROLS_SECTIONS.map((node) => (
        <DynamicSection key={`${collapseNonce}-${node.key}`} node={node} />
      ))}
    </Pane>
  );
}
