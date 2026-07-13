// views/InfoPane/InfoPane.tsx — the "Info" tab shell. Hosts two subtabs:
// Overview (the almanac, default) and Legend (how the city reads). Owns the
// Pane chrome + active-subtab state; the subtab bodies render themselves. The
// repo's own content (file tree, README) lives in the Explore pane.

import './InfoPane.css';
import { useState } from 'preact/hooks';
import { useSignalEffect } from '@preact/signals';
import type { Signal } from '@preact/signals';
import type { ComponentType } from 'preact';
import { Globe, Map } from 'lucide-preact';
import type { LucideIcon } from 'lucide-preact';
import type { DirNode, Manifest } from '@/types';
import { Pane } from '@/components/Pane';
import { PaneCloseButton } from '@/components/PaneHeader/PaneHeader';
import { PaneTabs } from '@/components/PaneTabs/PaneTabs';
import { CURRENT_SOURCE } from '@/state/stores/source';
import { OverviewPane } from './OverviewPane';
import { LegendPane } from './LegendPane';

type ManifestSignal = Signal<Manifest | DirNode | { tree?: unknown; [k: string]: unknown } | null>;

export enum InfoTab {
  Overview = 'overview',
  Legend = 'legend',
}

interface InfoTabDef {
  id: InfoTab;
  label: string;
  icon: LucideIcon;
  Component: ComponentType<{ manifest: ManifestSignal }>;
}

// Legend is static (no manifest) but keeps the shared signature so INFO_TABS
// stays uniform; it simply ignores the prop.
const INFO_TABS: InfoTabDef[] = [
  { id: InfoTab.Overview, label: 'Overview', icon: Globe, Component: OverviewPane },
  { id: InfoTab.Legend, label: 'Legend', icon: Map, Component: LegendPane },
];

export interface InfoPaneProps {
  manifest: ManifestSignal;
  onClose?: () => void;
}

export function InfoPane({ manifest, onClose }: InfoPaneProps) {
  const [tab, setTab] = useState<InfoTab>(InfoTab.Overview);
  const active = INFO_TABS.find((t) => t.id === tab) ?? INFO_TABS[0];

  // Reset to Overview when a new world commits — InfoPane stays mounted across
  // world switches, so its subtab would otherwise persist. Keyed on
  // CURRENT_SOURCE (not the manifest), so an in-place refresh keeps your subtab.
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
