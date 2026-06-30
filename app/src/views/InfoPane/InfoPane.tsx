// views/InfoPane/InfoPane.tsx — the "Info" tab shell. Hosts two subtabs:
// Overview (the almanac, default) and Readme (the rendered root README). Owns
// the Pane chrome + active-subtab state; the subtab bodies render themselves.

import './InfoPane.css';
import { useState } from 'preact/hooks';
import { useSignalEffect } from '@preact/signals';
import type { Signal } from '@preact/signals';
import type { ComponentType } from 'preact';
import { Globe, BookOpen } from 'lucide-preact';
import type { LucideIcon } from 'lucide-preact';
import type { DirNode, Manifest } from '@/types';
import { Pane } from '@/components/Pane';
import { PaneCloseButton } from '@/components/PaneHeader/PaneHeader';
import { PaneTabs, panePanelId, paneTabId } from '@/components/PaneTabs/PaneTabs';
import { CURRENT_SOURCE } from '@/state/stores/source';
import { OverviewPane } from './OverviewPane';
import { ReadmePane } from './ReadmePane';

type ManifestSignal = Signal<Manifest | DirNode | { tree?: unknown; [k: string]: unknown } | null>;

export enum InfoTab {
  Overview = 'overview',
  Readme = 'readme',
}

interface InfoTabDef {
  id: InfoTab;
  label: string;
  icon: LucideIcon;
  Component: ComponentType<{ manifest: ManifestSignal }>;
}

const INFO_TABS: InfoTabDef[] = [
  { id: InfoTab.Overview, label: 'Overview', icon: Globe, Component: OverviewPane },
  { id: InfoTab.Readme, label: 'Readme', icon: BookOpen, Component: ReadmePane },
];
const INFO_TABS_ID = 'info-pane';

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
            idPrefix={INFO_TABS_ID}
            tabs={INFO_TABS}
            active={tab}
            onSelect={(id) => setTab(id as InfoTab)}
          />
          {onClose && <PaneCloseButton onClose={onClose} />}
        </div>
      }
    >
      <div
        id={panePanelId(INFO_TABS_ID, active.id)}
        class="pane-body info-body"
        role="tabpanel"
        aria-labelledby={paneTabId(INFO_TABS_ID, active.id)}
      >
        <active.Component manifest={manifest} />
      </div>
    </Pane>
  );
}
