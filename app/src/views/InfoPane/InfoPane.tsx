// views/InfoPane/InfoPane.tsx — the "Info" tab shell. Hosts two subtabs:
// World (the almanac, default) and Readme (the rendered root README). Owns the
// Pane chrome + active-subtab state; the subtab bodies render themselves.

import './InfoPane.css';
import { useState } from 'preact/hooks';
import type { Signal } from '@preact/signals';
import { Globe, BookOpen } from 'lucide-preact';
import type { DirNode, Manifest } from '@/types';
import { Pane } from '@/components/Pane';
import { PaneTabs } from '@/components/PaneTabs/PaneTabs';
import { WorldPane } from './WorldPane';
import { ReadmePane } from './ReadmePane';

type InfoTab = 'world' | 'readme';

const INFO_TABS = [
  { id: 'world', label: 'Overview', icon: Globe },
  { id: 'readme', label: 'Readme', icon: BookOpen },
];

export interface InfoPaneProps {
  manifest: Signal<Manifest | DirNode | { tree?: unknown; [k: string]: unknown } | null>;
  onClose?: () => void;
}

export function InfoPane({ manifest, onClose }: InfoPaneProps) {
  const [tab, setTab] = useState<InfoTab>('world');
  return (
    <Pane paneClass="info-pane" title="Info" onClose={onClose}>
      <PaneTabs tabs={INFO_TABS} active={tab} onSelect={(id) => setTab(id as InfoTab)} />
      <div class="pane-body info-body">
        {tab === 'world' ? <WorldPane manifest={manifest} /> : <ReadmePane manifest={manifest} />}
      </div>
    </Pane>
  );
}
