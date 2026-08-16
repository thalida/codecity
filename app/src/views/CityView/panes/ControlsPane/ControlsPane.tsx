// panes/ControlsPane — the left sidebar's Settings pane: the World sections,
// all draft-backed, over the sticky Reset all / Discard / Save bar. Open-state
// is deliberately not persisted, so collapsing the pane bumps collapseNonce and
// every section remounts at its default.

import './ControlsPane.css';
import { useEffect, useState } from 'preact/hooks';
import { DynamicSection } from '@/components/DynamicSection/DynamicSection';
import type { SectionNode } from '@/types/controls';
import { VIEW_SECTION } from './sectionConfigs/View';
import { WORLD_SECTION } from './sectionConfigs/World';
import { BUILDINGS_SECTION } from './sectionConfigs/Buildings';
import { STREETS_SECTION } from './sectionConfigs/Streets';
import { FOOTPRINT_SECTION } from './sectionConfigs/Footprint';
import { GEM_SECTION } from './sectionConfigs/Gem';
import { TREES_SECTION } from './sectionConfigs/Trees';
import { FIREFLIES_SECTION } from './sectionConfigs/Fireflies';
import { POST_PROCESSING_SECTION } from './sectionConfigs/PostProcessing';
import { TIMELINE_SECTION } from './sectionConfigs/Timeline';
import { Pane } from '@/components/Pane/Pane';
import { PaneHeader } from '@/components/PaneHeader/PaneHeader';
import { RotateCcw } from 'lucide-preact';
import {
  commit as commitDrafts,
  discard as discardDrafts,
  isDirty as draftsAreDirty,
  stageResetAll,
  anyResettable,
  DRAFTS_REV,
} from '@/state/settings/drafts';
import { HAS_ANY_NON_DEFAULT } from '@/state/settings/schema';

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

/** The sticky Reset all | Discard · Save bar. Both signals are tracked, so it
 *  re-renders on a draft OR a committed change. */
function actionBar() {
  void DRAFTS_REV.value;
  void HAS_ANY_NON_DEFAULT.value;
  const dirty = draftsAreDirty();
  const canReset = anyResettable();

  return (
    <div class="controls-actions surface-sidebar">
      <div class="controls-actions-left">
        <button
          type="button"
          class="btn-secondary controls-button"
          title="Stage every overridden value back to its default. Click Save to apply."
          disabled={!canReset}
          onClick={() => stageResetAll()}
        >
          <RotateCcw class="icon controls-button-icon" />
          Reset all
        </button>
      </div>
      <div class="controls-actions-right">
        <button
          type="button"
          class="btn-secondary controls-button"
          title="Drop all unsaved changes."
          disabled={!dirty}
          onClick={() => discardDrafts()}
        >
          Discard
        </button>
        <button
          type="button"
          class="btn-primary controls-button"
          title="Apply unsaved changes to the scene."
          disabled={!dirty}
          onClick={() => commitDrafts()}
        >
          Save
        </button>
      </div>
    </div>
  );
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
      footerSlot={actionBar()}
    >
      {CONTROLS_SECTIONS.map((node) => (
        <DynamicSection key={`${collapseNonce}-${node.key}`} node={node} />
      ))}
    </Pane>
  );
}
