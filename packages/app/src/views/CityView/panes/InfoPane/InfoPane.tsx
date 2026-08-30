// views/InfoPane/InfoPane.tsx — the "Info" tab shell. Hosts two subtabs:
// Overview (the almanac, default) and Legend (how the city reads). Owns the
// Pane chrome + active-subtab state; the subtab bodies render themselves. The
// repo's own content (file tree, README) lives in the Explore pane.

import type { DirNode, Manifest } from '@codecity/city';
import './InfoPane.css';
import { useState } from 'preact/hooks';
import { useSignalEffect } from '@preact/signals';
import type { ComponentType } from 'preact';
import { Globe, Map } from 'lucide-preact';
import type { LucideIcon } from 'lucide-preact';
import { Pane } from '@/components/panes/Pane/Pane';
import { PaneCloseButton } from '@/components/panes/PaneCloseButton/PaneCloseButton';
import { PaneTabs } from '@/components/panes/PaneTabs/PaneTabs';
import { CURRENT_SOURCE } from '@/state/stores/source';
import { OverviewTab } from './tabs/OverviewTab/OverviewTab';
import { LegendTab } from './tabs/LegendTab/LegendTab';

type PaneManifest = Manifest | DirNode | { tree?: unknown; [k: string]: unknown } | null;

export enum InfoTab {
  Overview = 'overview',
  Legend = 'legend',
}

interface InfoTabDef {
  id: InfoTab;
  label: string;
  icon: LucideIcon;
  Component: ComponentType<{ manifest: PaneManifest }>;
}

// Legend is static (no manifest) but keeps the shared signature so INFO_TABS
// stays uniform; it simply ignores the prop.
const INFO_TABS: InfoTabDef[] = [
  { id: InfoTab.Overview, label: 'Overview', icon: Globe, Component: OverviewTab },
  { id: InfoTab.Legend, label: 'Legend', icon: Map, Component: LegendTab },
];

export interface InfoPaneProps {
  manifest: PaneManifest;
  onClose?: () => void;
}

export function InfoPane({ manifest, onClose }: InfoPaneProps) {
  const [tab, setTab] = useState<InfoTab>(InfoTab.Overview);
  const active = INFO_TABS.find((t) => t.id === tab) ?? INFO_TABS[0];

  // A new world resets to Overview; keyed on CURRENT_SOURCE, not the manifest,
  // so an in-place refresh keeps the tab you were on.
  useSignalEffect(() => {
    if (CURRENT_SOURCE.value) setTab(InfoTab.Overview);
  });
  return (
    <Pane
      paneClass="info-pane"
      headerSlot={
        <div class="pane-header pane-header--tabs">
          <PaneTabs
            tabs={INFO_TABS}
            active={tab}
            onSelect={(id) => setTab(id as InfoTab)}
            panelId="info-panel"
          />
          {onClose && <PaneCloseButton onClose={onClose} />}
        </div>
      }
    >
      <div
        class="pane-body info-body"
        id="info-panel"
        role="tabpanel"
        aria-labelledby={`info-panel-tab-${tab}`}
      >
        <active.Component manifest={manifest} />
      </div>
    </Pane>
  );
}
