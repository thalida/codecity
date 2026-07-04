// views/ControlsPane/ControlsPane.tsx — "Settings" tab in the left sidebar.
//
// Composition shell: World, Updates, Preview subtabs. The active subtab's
// sections render into the scrolling body. World is draft-backed (9
// accordion sections + the sticky Reset all/Discard/Save ActionsBar);
// Updates and Preview autosave (Task 6) and each hold one section, so they
// render inline (no footer, no <details> — a one-item accordion is pointless
// UI). Shortcuts and Debug moved to header-triggered modals (Tasks 8/9).
//
// Section / subgroup open-state is intentionally NOT persisted: when the pane
// hides we collapse every <details> and reset the active subtab to World, so
// the panel always reopens fresh.

import './ControlsPane.css';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Boxes, RefreshCw, Eye } from 'lucide-preact';
import type { LucideIcon } from 'lucide-preact';
import { FilePreviewSection } from './partials/FilePreviewSection';
import { DynamicSection, type SectionNode } from './partials';
import { SCENE_SECTION } from './partials/Scene';
import { ISLAND_SECTION } from './partials/Island';
import { BUILDINGS_SECTION } from './partials/Buildings';
import { STREETS_SECTION } from './partials/Streets';
import { FOOTPRINT_SECTION } from './partials/Footprint';
import { GEM_SECTION } from './partials/Gem';
import { TREES_SECTION } from './partials/Trees';
import { FIREFLIES_SECTION } from './partials/Fireflies';
import { EFFECTS_SECTION } from './partials/Effects';
import { UPDATES_SECTION } from './partials/Updates';
import { ActionsBar } from './ActionsBar/ActionsBar';
import { Pane } from '@/components/Pane';
import { PaneCloseButton } from '@/components/PaneHeader/PaneHeader';
import { PaneTabs } from '@/components/PaneTabs/PaneTabs';

interface Subtab {
  id: string;
  label: string;
  icon: LucideIcon;
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
  const paneRef = useRef<HTMLDivElement>(null);
  const [activeId, setActiveId] = useState('world');

  const subtabs: Subtab[] = [
    {
      id: 'world',
      label: 'World',
      icon: Boxes,
      draftable: true,
      sections: [
        SCENE_SECTION,
        ISLAND_SECTION,
        BUILDINGS_SECTION,
        STREETS_SECTION,
        FOOTPRINT_SECTION,
        GEM_SECTION,
        TREES_SECTION,
        FIREFLIES_SECTION,
        EFFECTS_SECTION,
      ],
    },
    {
      id: 'updates',
      label: 'Updates',
      icon: RefreshCw,
      draftable: false,
      sections: [{ ...UPDATES_SECTION, inline: true }],
    },
    {
      id: 'preview',
      label: 'Preview',
      icon: Eye,
      draftable: false,
      sections: [{ key: 'file-preview', render: <FilePreviewSection /> }],
    },
  ];

  const active = subtabs.find((t) => t.id === activeId) ?? subtabs[0];

  useEffect(() => {
    if (!collapsed) return;
    setActiveId('world');
    paneRef.current
      ?.querySelectorAll<HTMLDetailsElement>('details')
      .forEach((d) => (d.open = false));
  }, [collapsed]);

  return (
    <Pane
      paneClass="controls-pane"
      paneRef={paneRef}
      headerSlot={
        <div class="pane-header pane-header--tabs">
          <PaneTabs tabs={subtabs} active={activeId} onSelect={setActiveId} />
          {onClose && <PaneCloseButton onClose={onClose} />}
        </div>
      }
      bodyClass="pane-body--padded"
      footerSlot={active.draftable ? <ActionsBar /> : null}
    >
      {active.sections.map((node) => (
        <DynamicSection key={node.key} node={node} />
      ))}
    </Pane>
  );
}
