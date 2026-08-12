// views/ControlsPane/ControlsPane.tsx — "Settings" tab in the left sidebar:
// the World sections, all draft-backed, over the sticky Reset all/Discard/Save
// ActionsBar. Scan settings live in the header's scan menu and appearance in
// the footer's, so there is one subject here and no tabs to choose it with.
//
// Open-state is deliberately not persisted: collapsing the pane bumps
// collapseNonce to remount every section back at its default.

import './ControlsPane.css';
import { useEffect, useState } from 'preact/hooks';
import { DynamicSection, type SectionNode } from './partials';
import { VIEW_SECTION } from './partials/View';
import { SKY_SECTION } from './partials/Sky';
import { ISLAND_SECTION } from './partials/Island';
import { BUILDINGS_SECTION } from './partials/Buildings';
import { STREETS_SECTION } from './partials/Streets';
import { FOOTPRINT_SECTION } from './partials/Footprint';
import { GEM_SECTION } from './partials/Gem';
import { TREES_SECTION } from './partials/Trees';
import { FIREFLIES_SECTION } from './partials/Fireflies';
import { POST_PROCESSING_SECTION } from './partials/PostProcessing';
import { TIMELINE_SECTION } from './partials/Timeline';
import { ActionsBar } from './ActionsBar/ActionsBar';
import { Pane } from '@/components/Pane';
import { PaneHeader } from '@/components/PaneHeader/PaneHeader';

/** Hoisted out of the render because a test asserts the invariant that every
 *  field under here is draft-backed: these all stage into the footer's
 *  Save/Discard/Reset, with no write-through exceptions. */
// Ordered outside-in: where you look from, then the world, then the city, then
// what lives around it, then whole-frame passes.
export const WORLD_SECTIONS: SectionNode[] = [
  VIEW_SECTION,
  SKY_SECTION,
  ISLAND_SECTION,
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
  /** When true the panel is hidden (sidebar collapsed), which collapses every
   *  section so the panel reopens fresh. Declarative: the parent just passes
   *  its collapsed state. */
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
      headerSlot={<PaneHeader title="World" onClose={onClose} />}
      bodyClass="pane-inset"
      footerSlot={<ActionsBar />}
    >
      {WORLD_SECTIONS.map((node) => (
        <DynamicSection key={`${collapseNonce}-${node.key}`} node={node} />
      ))}
    </Pane>
  );
}
