// views/InfoPane/InfoPane.tsx — the "Info" tab shell. Hosts two subtabs:
// Overview (the almanac, default) and Readme (the rendered root README). Owns
// the Pane chrome + active-subtab state; the subtab bodies render themselves.

import './InfoPane.css';
import { useState } from 'preact/hooks';
import type { Signal } from '@preact/signals';
import type { ComponentType } from 'preact';
import { Globe, BookOpen } from 'lucide-preact';
import type { LucideIcon } from 'lucide-preact';
import type { DirNode, Manifest } from '@/types';
import { Pane } from '@/components/Pane';
import { PaneTabs } from '@/components/PaneTabs/PaneTabs';
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

export interface InfoPaneProps {
  manifest: ManifestSignal;
  onClose?: () => void;
}

export function InfoPane({ manifest, onClose }: InfoPaneProps) {
  const [tab, setTab] = useState<InfoTab>(InfoTab.Overview);
  const active = INFO_TABS.find((t) => t.id === tab) ?? INFO_TABS[0];
  const Body = active.Component;
  return (
    <Pane paneClass="info-pane" title="Info" onClose={onClose}>
      <PaneTabs tabs={INFO_TABS} active={tab} onSelect={(id) => setTab(id as InfoTab)} />
      <div class="pane-body info-body">
        <Body manifest={manifest} />
      </div>
    </Pane>
  );
}
