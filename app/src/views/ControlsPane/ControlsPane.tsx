// views/ControlsPane/ControlsPane.tsx — "Settings" tab in the left sidebar.
//
// Composition shell. The 13 sections are grouped onto PaneTabs subtabs; the
// active subtab's sections render into the scrolling body. The sticky
// ActionsBar (Reset all · Discard · Save) shows only on DRAFTABLE subtabs
// (World, Updates, Preview) — Shortcuts is reference and Debug is actions, so
// there is nothing to Save there.
//
// Section / subgroup open-state is intentionally NOT persisted: when the pane
// hides we collapse every <details> and reset the active subtab to World, so
// the panel always reopens fresh.

import './ControlsPane.css';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Boxes, RefreshCw, Eye, Keyboard, Bug } from 'lucide-preact';
import type { LucideIcon } from 'lucide-preact';
import { ShortcutsSection } from './partials/ShortcutsSection/ShortcutsSection';
import { FilePreviewSection } from './partials/FilePreviewSection';
import { DebugSection } from './partials/DebugSection';
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
  onRunCollisionCheck?: () => void;
  onRunStemDiagnostic?: () => void;
  /** When true the panel is hidden (sidebar collapsed). On that transition we
   *  collapse every section and reset to the World subtab so the panel reopens
   *  fresh. Declarative: the parent just passes its collapsed state. */
  collapsed?: boolean;
}

export function ControlsPane({
  onClose,
  onRunCollisionCheck,
  onRunStemDiagnostic,
  collapsed,
}: ControlsPaneProps) {
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
      draftable: true,
      sections: [UPDATES_SECTION],
    },
    {
      id: 'preview',
      label: 'Preview',
      icon: Eye,
      draftable: true,
      sections: [{ key: 'file-preview', render: <FilePreviewSection /> }],
    },
    {
      id: 'shortcuts',
      label: 'Shortcuts',
      icon: Keyboard,
      draftable: false,
      sections: [{ key: 'shortcuts', render: <ShortcutsSection /> }],
    },
    {
      id: 'debug',
      label: 'Debug',
      icon: Bug,
      draftable: false,
      sections: [
        {
          key: 'debug',
          render: (
            <DebugSection
              onRunCollisionCheck={onRunCollisionCheck}
              onRunStemDiagnostic={onRunStemDiagnostic}
            />
          ),
        },
      ],
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
