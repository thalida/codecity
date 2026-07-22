// views/ControlsPane/ControlsPane.tsx — "Settings" tab in the left sidebar.
//
// Composition shell: Scan, Appearance, World subtabs, each carrying a count of
// its changed-from-default items. The active subtab's sections render into the scrolling
// body. Scan + Appearance autosave (their sections open by default); World is
// draft-backed (10 collapsed accordion sections + the sticky Reset all/Discard/
// Save ActionsBar). Shortcuts and Debug moved to header-triggered modals.
//
// Section / subgroup open-state is intentionally NOT persisted: when the pane
// hides we remount every section (via collapseNonce) so each returns to its
// default open-state, and reset the active subtab to Scan, so the panel always
// reopens fresh.

import './ControlsPane.css';
import { useEffect, useState } from 'preact/hooks';
import { Boxes, RefreshCw, Palette } from 'lucide-preact';
import type { LucideIcon } from 'lucide-preact';
import { ExcludesSection } from './partials/ExcludesSection';
import { FilePreviewSection } from './partials/FilePreviewSection';
import { InterfaceThemeSection } from './partials/InterfaceThemeSection';
import { DynamicSection, type SectionNode } from './partials';
import { CAMERA_SECTION } from './partials/Camera';
import { SCENE_SECTION } from './partials/Scene';
import { ISLAND_SECTION } from './partials/Island';
import { BUILDINGS_SECTION } from './partials/Buildings';
import { STREETS_SECTION } from './partials/Streets';
import { FOOTPRINT_SECTION } from './partials/Footprint';
import { GEM_SECTION } from './partials/Gem';
import { TREES_SECTION } from './partials/Trees';
import { FIREFLIES_SECTION } from './partials/Fireflies';
import { EFFECTS_SECTION } from './partials/Effects';
import { RUINS_SECTION } from './partials/Ruins';
import { UPDATES_SECTION } from './partials/Updates';
import { ActionsBar } from './ActionsBar/ActionsBar';
import { SCAN_COUNT, APPEARANCE_COUNT, WORLD_COUNT } from '@/state/stores/settingsIndicators';
import { Pane } from '@/components/Pane';
import { PaneCloseButton } from '@/components/PaneHeader/PaneHeader';
import { PaneTabs } from '@/components/PaneTabs/PaneTabs';

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
  const [activeId, setActiveId] = useState('updates');
  // Sections/subgroups own their open-state locally; bumping this nonce on
  // collapse remounts them so each reopens at its default (World collapsed,
  // Scan/Appearance expanded via defaultOpen).
  const [collapseNonce, setCollapseNonce] = useState(0);

  const subtabs: Subtab[] = [
    {
      id: 'updates',
      label: 'Scan',
      icon: RefreshCw,
      badge: SCAN_COUNT.value,
      draftable: false,
      sections: [
        UPDATES_SECTION,
        { key: 'excludes', label: 'Excluded from city', render: <ExcludesSection /> },
      ],
    },
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
      sections: [
        CAMERA_SECTION,
        SCENE_SECTION,
        ISLAND_SECTION,
        BUILDINGS_SECTION,
        STREETS_SECTION,
        FOOTPRINT_SECTION,
        GEM_SECTION,
        TREES_SECTION,
        FIREFLIES_SECTION,
        EFFECTS_SECTION,
        RUINS_SECTION,
      ],
    },
  ];

  const active = subtabs.find((t) => t.id === activeId) ?? subtabs[0];

  useEffect(() => {
    if (!collapsed) return;
    setActiveId('updates');
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
