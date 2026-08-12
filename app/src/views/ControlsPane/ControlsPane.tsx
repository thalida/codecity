// views/ControlsPane/ControlsPane.tsx — "Settings" tab in the left sidebar:
// Appearance (autosaves) and World (draft-backed, hence the ActionsBar footer).
// Scan settings live in the header's scan menu, not here.
//
// Open-state is deliberately not persisted: collapsing the pane bumps
// collapseNonce to remount every section back at its default.

import './ControlsPane.css';
import { useEffect, useState } from 'preact/hooks';
import { Boxes, Palette } from 'lucide-preact';
import type { LucideIcon } from 'lucide-preact';
import { FilePreviewSection } from './partials/FilePreviewSection';
import { InterfaceThemeSection } from './partials/InterfaceThemeSection';
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
import { APPEARANCE_COUNT, WORLD_COUNT } from '@/state/stores/settingsIndicators';
import { Pane } from '@/components/Pane';
import { PaneCloseButton } from '@/components/PaneHeader/PaneHeader';
import { PaneTabs } from '@/components/PaneTabs/PaneTabs';

/** The World tab's sections. Hoisted out of the render because a test asserts
 *  the invariant that every field under here is draft-backed: World settings all
 *  stage into the footer's Save/Discard/Reset, with no write-through exceptions. */
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

/** Opened-on, and returned to when the pane collapses: the lighter of the two,
 *  and the one that doesn't stage a draft. */
const DEFAULT_TAB = 'appearance';

interface Subtab {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Count of changed-from-default items under this tab; shown as a tab badge. */
  badge?: number;
  /** Draftable subtabs get the Save/Discard/Reset footer. */
  draftable: boolean;
  sections: SectionNode[];
}

export interface ControlsPaneProps {
  onClose?: () => void;
  /** When true the panel is hidden (sidebar collapsed). On that transition we
   *  collapse every section and reset to the World subtab so the panel reopens
   *  fresh. Declarative: the parent just passes its collapsed state. */
  collapsed?: boolean;
}

export function ControlsPane({ onClose, collapsed }: ControlsPaneProps) {
  const [activeId, setActiveId] = useState(DEFAULT_TAB);
  // Sections/subgroups own their open-state locally; bumping this nonce on
  // collapse remounts them so each reopens at its default (World collapsed,
  // Appearance expanded via defaultOpen).
  const [collapseNonce, setCollapseNonce] = useState(0);

  const subtabs: Subtab[] = [
    {
      id: 'appearance',
      label: 'Appearance',
      icon: Palette,
      badge: APPEARANCE_COUNT.value,
      draftable: false,
      sections: [
        { key: 'interface-theme', render: <InterfaceThemeSection /> },
        { key: 'file-preview', render: <FilePreviewSection /> },
      ],
    },
    {
      id: 'world',
      label: 'World',
      icon: Boxes,
      badge: WORLD_COUNT.value,
      draftable: true,
      sections: WORLD_SECTIONS,
    },
  ];

  const active = subtabs.find((t) => t.id === activeId) ?? subtabs[0];

  useEffect(() => {
    if (!collapsed) return;
    setActiveId(DEFAULT_TAB);
    setCollapseNonce((n) => n + 1);
  }, [collapsed]);

  return (
    <Pane
      paneClass="controls-pane"
      headerSlot={
        <div class="pane-header pane-header--tabs">
          <PaneTabs
            tabs={subtabs}
            active={activeId}
            onSelect={setActiveId}
            panelId="controls-panel"
          />
          {onClose && <PaneCloseButton onClose={onClose} />}
        </div>
      }
      bodyClass="pane-inset"
      bodyProps={{
        id: 'controls-panel',
        role: 'tabpanel',
        'aria-labelledby': `controls-panel-tab-${activeId}`,
      }}
      footerSlot={active.draftable ? <ActionsBar /> : null}
    >
      {active.sections.map((node) => (
        <DynamicSection key={`${collapseNonce}-${node.key}`} node={node} />
      ))}
    </Pane>
  );
}
